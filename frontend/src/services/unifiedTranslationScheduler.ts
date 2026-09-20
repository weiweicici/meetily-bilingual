/**
 * UnifiedTranslationScheduler
 *
 * Single point of dispatch for all real-time and historical Gemini translation requests.
 * Features:
 * 1. Unified concurrency limit (default 1).
 * 2. Rate limiting & request spacing.
 * 3. 429 exponential backoff with shared scheduler cooldown (no model looping on 429).
 * 4. 404/400 model unavailability caching per session.
 * 5. 401/403 non-retryable auth error handling.
 * 6. Bounded FIFO queue with task cancellation and timeout.
 */

/**
 * Minimal verified candidate models for low-latency text translation.
 * Verified against Google AI official documentation on 2026-09-20:
 * - gemini-2.5-flash: Primary stable model, optimized for low-latency text translation.
 * - gemini-2.5-flash-lite: Lightweight low-latency fallback.
 * 
 * Note: 404 fallback is strictly for unexpected endpoint deprecation/outage,
 * NOT a regular model discovery mechanism.
 */
export const OFFICIAL_CANDIDATE_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

export interface SchedulerOptions {
  maxConcurrency?: number;
  minIntervalMs?: number; // Minimum spacing between requests to respect RPM
  maxQueueSize?: number;
  requestTimeoutMs?: number;
  fetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  backendTranslateFn?: (text: string, model: string, signal?: AbortSignal) => Promise<string>;
}

export interface EnqueueTaskOptions {
  id: string;
  text: string;
  apiKey?: string;
  signal?: AbortSignal;
}

interface QueuedItem {
  options: EnqueueTaskOptions;
  resolve: (value: string | null) => void;
  reject: (reason: unknown) => void;
  attempts: number;
}

export class AuthError extends Error {
  constructor(message = 'Gemini API key is invalid or unauthorized') {
    super(message);
    this.name = 'AuthError';
  }
}

export class UnifiedTranslationScheduler {
  private maxConcurrency: number;
  private minIntervalMs: number;
  private maxQueueSize: number;
  private requestTimeoutMs: number;
  private fetchFn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  private backendTranslateFn?: (text: string, model: string, signal?: AbortSignal) => Promise<string>;

  private queue: QueuedItem[] = [];
  private activeCount = 0;
  private cooldownUntil = 0;
  private lastRequestTime = 0;
  private disabledModels = new Set<string>();
  private preferredModelIndex = 0;
  private consecutive429s = 0;
  private isProcessingLoopActive = false;

  constructor(options: SchedulerOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? 1;
    this.minIntervalMs = options.minIntervalMs ?? 1000; // 1s spacing by default
    this.maxQueueSize = options.maxQueueSize ?? 100;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 8000;
    this.fetchFn = options.fetchFn ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : (null as unknown as typeof fetch));
    this.backendTranslateFn = options.backendTranslateFn;
  }

  public setBackendTranslateFn(fn?: (text: string, model: string, signal?: AbortSignal) => Promise<string>): void {
    this.backendTranslateFn = fn;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public isCoolingDown(): boolean {
    return Date.now() < this.cooldownUntil;
  }

  public getDisabledModels(): string[] {
    return Array.from(this.disabledModels);
  }

  public resetDisabledModels(): void {
    this.disabledModels.clear();
    this.preferredModelIndex = 0;
  }

  public clear(): void {
    const cancelledItems = this.queue.splice(0, this.queue.length);
    for (const item of cancelledItems) {
      item.resolve(null);
    }
  }

  /**
   * Enqueue a translation request.
   */
  public enqueue(options: EnqueueTaskOptions): Promise<string | null> {
    return new Promise((resolve, reject) => {
      // Check if already cancelled
      if (options.signal?.aborted) {
        resolve(null);
        return;
      }

      // Check queue bounds
      if (this.queue.length >= this.maxQueueSize) {
        // Drop oldest task to prevent unbounded memory growth
        const dropped = this.queue.shift();
        if (dropped) {
          dropped.resolve(null);
        }
      }

      this.queue.push({
        options,
        resolve,
        reject,
        attempts: 0,
      });

      this.scheduleNext();
    });
  }

  private scheduleNext(): void {
    if (this.isProcessingLoopActive) return;
    this.isProcessingLoopActive = true;

    setTimeout(async () => {
      try {
        while (this.queue.length > 0 && this.activeCount < this.maxConcurrency) {
          const now = Date.now();

          // Check cooldown from 429
          if (now < this.cooldownUntil) {
            const waitMs = this.cooldownUntil - now;
            await new Promise(r => setTimeout(r, waitMs));
            continue;
          }

          // Check rate limit spacing
          const elapsed = now - this.lastRequestTime;
          if (elapsed < this.minIntervalMs) {
            await new Promise(r => setTimeout(r, this.minIntervalMs - elapsed));
            continue;
          }

          const item = this.queue.shift();
          if (!item) break;

          // If item was cancelled while in queue
          if (item.options.signal?.aborted) {
            item.resolve(null);
            continue;
          }

          this.activeCount++;
          this.lastRequestTime = Date.now();

          // Execute task in background
          this.executeTask(item).finally(() => {
            this.activeCount--;
            this.scheduleNext();
          });
        }
      } finally {
        this.isProcessingLoopActive = false;
      }
    }, 0);
  }

  private async executeTask(item: QueuedItem): Promise<void> {
    const { text, apiKey, signal } = item.options;
    const trimmed = text.trim();

    if (!trimmed || (!apiKey && !this.backendTranslateFn)) {
      item.resolve(null);
      return;
    }

    // Filter candidate models excluding any that previously returned 404 in this session
    const availableModels = OFFICIAL_CANDIDATE_MODELS.filter(m => !this.disabledModels.has(m));
    if (availableModels.length === 0) {
      console.warn('[TranslationScheduler] All candidate models are disabled for this session.');
      item.resolve(null);
      return;
    }

    // Order with preferred model first
    const preferredModel = OFFICIAL_CANDIDATE_MODELS[this.preferredModelIndex];
    const orderedModels: string[] = [
      ...(availableModels.includes(preferredModel) ? [preferredModel] : []),
      ...availableModels.filter(m => m !== preferredModel),
    ];

    for (const model of orderedModels) {
      if (signal?.aborted) {
        item.resolve(null);
        return;
      }

      // 1. If backend translation function is configured (e.g. Tauri Rust command), prioritize it
      if (this.backendTranslateFn) {
        try {
          const candidateText = await this.backendTranslateFn(trimmed, model, signal);
          this.consecutive429s = 0;
          if (typeof candidateText === 'string' && candidateText.trim()) {
            const successIdx = OFFICIAL_CANDIDATE_MODELS.indexOf(model);
            if (successIdx !== -1) {
              this.preferredModelIndex = successIdx;
            }

            const cleaned = candidateText
              .trim()
              .replace(/^[*\-•#\s:]+/, '')
              .replace(/^翻译[:：]\s*/, '')
              .trim();

            item.resolve(cleaned || candidateText.trim());
            return;
          }
        } catch (err: unknown) {
          if (signal?.aborted) {
            item.resolve(null);
            return;
          }
          const errStr = String((err as { message?: string })?.message || err || '');
          if (errStr.includes('HTTP 401') || errStr.includes('HTTP 403')) {
            item.resolve(null);
            return;
          }
          if (errStr.includes('HTTP 429')) {
            this.consecutive429s++;
            const backoffMs = Math.min(30000, Math.pow(2, this.consecutive429s) * 1000 + Math.random() * 500);
            console.warn(`[TranslationScheduler] 429 Rate limited. Cooling down scheduler for ${backoffMs}ms`);
            this.cooldownUntil = Date.now() + backoffMs;
            if (item.attempts < 3) {
              item.attempts++;
              this.queue.unshift(item);
            } else {
              item.resolve(null);
            }
            return;
          }
          if (errStr.includes('HTTP 404') || errStr.includes('HTTP 400')) {
            console.warn(`[TranslationScheduler] Model ${model} returned 404/400, disabling for session.`);
            this.disabledModels.add(model);
            continue;
          }
          console.warn(`[TranslationScheduler] Backend translation error with model ${model}:`, err);
          continue;
        }
      }

      // 2. Otherwise fall back to fetchFn (HTTP request via browser/mock)
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

        // Chain caller abort signal if provided
        const onAbort = () => controller.abort();
        signal?.addEventListener('abort', onAbort);

        const response = await this.fetchFn(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey ?? '',
          },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: trimmed }],
              },
            ],
            systemInstruction: {
              parts: [
                {
                  text:
                    'You are a professional real-time speech translator. ' +
                    'Translate the following English speech transcript completely into natural, faithful Simplified Chinese. ' +
                    'Preserve technical terms, proper nouns, and product names accurately when appropriate. ' +
                    'Do NOT truncate the translation; translate the entire input text. ' +
                    'Do NOT explain, annotate, bullet-point, or provide commentary. ' +
                    'Output ONLY the raw Simplified Chinese translation text.',
                },
              ],
            },
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 1024,
            },
          }),
        });

        clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);

        if (response.status === 401 || response.status === 403) {
          // Authentication / permission error - fail immediately, no retry
          item.resolve(null);
          return;
        }

        if (response.status === 429) {
          // Rate limit exceeded - enforce shared cooldown and exponential backoff
          this.consecutive429s++;
          const retryAfterSec = parseInt(response.headers?.get('Retry-After') || '0', 10);
          const backoffMs = retryAfterSec > 0
            ? retryAfterSec * 1000
            : Math.min(30000, Math.pow(2, this.consecutive429s) * 1000 + Math.random() * 500);

          console.warn(`[TranslationScheduler] 429 Rate limited. Cooling down scheduler for ${backoffMs}ms`);
          this.cooldownUntil = Date.now() + backoffMs;

          // Re-enqueue task if retry attempts not exceeded
          if (item.attempts < 3) {
            item.attempts++;
            this.queue.unshift(item); // Priority retry
          } else {
            item.resolve(null);
          }
          return;
        }

        if (response.status === 404 || response.status === 400) {
          // Model does not exist or is unsupported - disable this model for the session
          console.warn(`[TranslationScheduler] Model ${model} returned HTTP ${response.status}, disabling for session.`);
          this.disabledModels.add(model);
          continue; // Try next model
        }

        if (!response.ok) {
          console.warn(`[TranslationScheduler] Model ${model} returned HTTP ${response.status}`);
          continue;
        }

        // Success - reset 429 backoff
        this.consecutive429s = 0;
        const data = await response.json();
        const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (typeof candidateText === 'string' && candidateText.trim()) {
          const successIdx = OFFICIAL_CANDIDATE_MODELS.indexOf(model);
          if (successIdx !== -1) {
            this.preferredModelIndex = successIdx;
          }

          const cleaned = candidateText
            .trim()
            .replace(/^[*\-•#\s:]+/, '')
            .replace(/^翻译[:：]\s*/, '')
            .trim();

          item.resolve(cleaned || candidateText.trim());
          return;
        }
      } catch (err) {
        if (signal?.aborted) {
          item.resolve(null);
          return;
        }
        console.warn(`[TranslationScheduler] Request error with model ${model}:`, err);
        continue;
      }
    }

    // All models exhausted
    item.resolve(null);
  }
}

// Global shared scheduler instance with default configuration
export const unifiedTranslationScheduler = new UnifiedTranslationScheduler();
