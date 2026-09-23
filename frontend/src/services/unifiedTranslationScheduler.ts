/**
 * UnifiedTranslationScheduler
 *
 * Single point of dispatch for all real-time English -> Simplified Chinese translation requests.
 * Hierarchy:
 * 1. Primary: Groq (openai/gpt-oss-20b -> openai/gpt-oss-120b)
 * 2. Fallback: Google Gemini (gemini-3.5-flash-lite -> gemini-3.6-flash)
 *
 * Features:
 * - Unified concurrency limit (default 1).
 * - Automatic Groq -> Gemini fallback on network error, timeout, 429, 5xx, or empty response.
 * - Session-level disabling for non-retryable 401/403 auth errors.
 * - Safe diagnostic logging without leaking secrets, transcripts, or translations.
 * - Bounded FIFO queue with task cancellation and timeout.
 */

import {
  translationDiagnosticLogger,
  classifyTranslationError,
} from './translationDiagnosticLogger.ts';
import { translationStatsTracker } from './translationStatsTracker.ts';

export const GROQ_CANDIDATE_MODELS = [
  'openai/gpt-oss-20b',
  'openai/gpt-oss-120b',
];

export const GEMINI_CANDIDATE_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
];

// For backward compatibility with existing tests
export const OFFICIAL_CANDIDATE_MODELS = GEMINI_CANDIDATE_MODELS;

export interface SchedulerOptions {
  maxConcurrency?: number;
  minIntervalMs?: number; // Minimum spacing between requests
  maxQueueSize?: number;
  requestTimeoutMs?: number;
  fetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  backendTranslateGroqFn?: (text: string, model: string, signal?: AbortSignal) => Promise<string>;
  backendTranslateGeminiFn?: (text: string, model: string, signal?: AbortSignal) => Promise<string>;
  backendTranslateFn?: (text: string, model: string, signal?: AbortSignal) => Promise<string>;
}

export interface EnqueueTaskOptions {
  id: string;
  text: string;
  apiKey?: string;
  signal?: AbortSignal;
  sequenceId?: number;
}

interface QueuedItem {
  options: EnqueueTaskOptions;
  resolve: (value: string | null) => void;
  reject: (reason: unknown) => void;
  attempts: number;
}

export const SHORT_SEGMENT_THRESHOLD = 20; // English word threshold
export const MAX_BATCH_SEGMENTS = 3;       // Max segments per batch
export const MAX_BATCH_WAIT_MS = 6000;     // Max wait time before auto-flushing (6s for classroom cadence)

export function countEnglishWords(text: string): number {
  return text
    .trim()
    .replace(/[^\w\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

interface PendingBatchItem {
  options: EnqueueTaskOptions;
  resolve: (value: string | null) => void;
  reject: (reason: unknown) => void;
  addedAt: number;
}

export class AuthError extends Error {
  constructor(message = 'Translation API key is invalid or unauthorized') {
    super(message);
    this.name = 'AuthError';
  }
}

export class UnifiedTranslationScheduler {
  private maxConcurrency: number;
  private minIntervalMs: number;
  private maxQueueSize: number;
  private requestTimeoutMs: number;
  private fetchFn?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  private backendTranslateGroqFn?: (text: string, model: string, signal?: AbortSignal) => Promise<string>;
  private backendTranslateGeminiFn?: (text: string, model: string, signal?: AbortSignal) => Promise<string>;

  private queue: QueuedItem[] = [];
  private pendingBatchItems: PendingBatchItem[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private activeCount = 0;
  private cooldownUntil = 0;
  private lastRequestTime = 0;
  private disabledGeminiModels = new Set<string>();
  private disabledGroqModels = new Set<string>();
  private isGroqDisabledForSession = false;
  private isGeminiDisabledForSession = false;
  private preferredGeminiModelIndex = 0;
  private preferredGroqModelIndex = 0;
  private consecutive429s = 0;
  private isProcessingLoopActive = false;

  constructor(options: SchedulerOptions = {}) {
    this.maxConcurrency = options.maxConcurrency ?? 1;
    this.minIntervalMs = options.minIntervalMs ?? 500; // 500ms spacing
    this.maxQueueSize = options.maxQueueSize ?? 100;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 8000;
    this.fetchFn = options.fetchFn ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined);
    this.backendTranslateGroqFn = options.backendTranslateGroqFn;
    this.backendTranslateGeminiFn = options.backendTranslateGeminiFn ?? options.backendTranslateFn;
  }

  public setBackendTranslateGroqFn(fn?: (text: string, model: string, signal?: AbortSignal) => Promise<string>): void {
    this.backendTranslateGroqFn = fn;
  }

  public setBackendTranslateGeminiFn(fn?: (text: string, model: string, signal?: AbortSignal) => Promise<string>): void {
    this.backendTranslateGeminiFn = fn;
  }

  // Backward compatibility alias
  public setBackendTranslateFn(fn?: (text: string, model: string, signal?: AbortSignal) => Promise<string>): void {
    this.backendTranslateGeminiFn = fn;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public getPendingBatchLength(): number {
    return this.pendingBatchItems.length;
  }

  public isCoolingDown(): boolean {
    return Date.now() < this.cooldownUntil;
  }

  public getDisabledModels(): string[] {
    return Array.from(this.disabledGeminiModels);
  }

  public resetDisabledModels(): void {
    this.flushPendingBatch('session_stop');
    this.disabledGeminiModels.clear();
    this.disabledGroqModels.clear();
    this.isGroqDisabledForSession = false;
    this.isGeminiDisabledForSession = false;
    this.preferredGeminiModelIndex = 0;
    this.preferredGroqModelIndex = 0;
  }

  public clear(): void {
    this.flushPendingBatch('session_stop');
    const cancelledItems = this.queue.splice(0, this.queue.length);
    for (const item of cancelledItems) {
      item.resolve(null);
    }
  }

  /**
   * Flush all pending short-segment batch items into execution tasks.
   */
  public flushPendingBatch(
    reason: 'word_threshold' | 'segment_limit' | 'timeout' | 'long_segment' | 'session_stop' = 'timeout'
  ): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    if (this.pendingBatchItems.length === 0) {
      return;
    }

    const itemsToFlush = [...this.pendingBatchItems];
    this.pendingBatchItems = [];

    const totalWordCount = itemsToFlush.reduce(
      (sum, item) => sum + countEnglishWords(item.options.text),
      0
    );
    const oldestWaitMs = Date.now() - itemsToFlush[0].addedAt;

    translationDiagnosticLogger.stageBatchFlush(reason, itemsToFlush.length, totalWordCount, oldestWaitMs);

    if (itemsToFlush.length === 1) {
      // Single segment: dispatch directly without batch overhead
      const item = itemsToFlush[0];
      this.enqueueInternal({
        options: item.options,
        resolve: item.resolve,
        reject: item.reject,
        attempts: 0,
      });
      return;
    }

    // Multi-segment batch request
    translationDiagnosticLogger.stageBatchRequest(itemsToFlush.length);

    const payloadItems = itemsToFlush.map((item, idx) => ({
      id: item.options.sequenceId ?? (idx + 1),
      text: item.options.text,
    }));

    // Explicit batch prompt format instructing model to output valid JSON array with sequence IDs
    const batchPromptHeader = `Translate the following English transcript segments into Simplified Chinese.
Return ONLY a valid JSON array of objects without markdown formatting or code blocks.
Each object in the array MUST have:
- "id": the exact numeric id from the input segment
- "translation": the Simplified Chinese translation string

Input Segments:
`;

    const batchText = batchPromptHeader + JSON.stringify(payloadItems, null, 2);

    const firstItem = itemsToFlush[0];
    const combinedSignal = firstItem.options.signal;
    const combinedApiKey = firstItem.options.apiKey;
    const batchSeq = firstItem.options.sequenceId;

    this.enqueueInternal({
      options: {
        id: `batch-${Date.now()}-${itemsToFlush.length}`,
        text: batchText,
        apiKey: combinedApiKey,
        signal: combinedSignal,
        sequenceId: batchSeq,
      },
      resolve: (rawResponse: string | null) => {
        if (!rawResponse) {
          translationDiagnosticLogger.stageBatchPartialMapping(itemsToFlush.length, 0, itemsToFlush.length);
          // Fallback: execute items individually if batch request failed
          for (const item of itemsToFlush) {
            this.enqueueInternal({
              options: item.options,
              resolve: item.resolve,
              reject: item.reject,
              attempts: 0,
            });
          }
          return;
        }

        // Parse structured batch response
        const mapped = this.parseBatchResponse(rawResponse, payloadItems);

        if (mapped.size > 1) {
          // Successfully batched segments!
          translationStatsTracker.recordBatchedSegments(mapped.size);
          translationDiagnosticLogger.stageBatchSuccess(itemsToFlush.length, mapped.size);
        }

        if (mapped.size < itemsToFlush.length) {
          const fallbackCount = itemsToFlush.length - mapped.size;
          translationDiagnosticLogger.stageBatchPartialMapping(itemsToFlush.length, mapped.size, fallbackCount);
        }

        for (const item of itemsToFlush) {
          const key = item.options.sequenceId ?? payloadItems.find(p => p.text === item.options.text)?.id;
          const translated = key !== undefined ? mapped.get(key) : undefined;

          if (translated) {
            item.resolve(translated);
          } else {
            // Fallback for any unmapped item: translate individually
            this.enqueueInternal({
              options: item.options,
              resolve: item.resolve,
              reject: item.reject,
              attempts: 0,
            });
          }
        }
      },
      reject: () => {
        translationDiagnosticLogger.stageBatchPartialMapping(itemsToFlush.length, 0, itemsToFlush.length);
        // Fallback on error
        for (const item of itemsToFlush) {
          this.enqueueInternal({
            options: item.options,
            resolve: item.resolve,
            reject: item.reject,
            attempts: 0,
          });
        }
      },
      attempts: 0,
    });
  }

  private parseBatchResponse(
    response: string,
    items: { id: number; text: string }[]
  ): Map<number, string> {
    const result = new Map<number, string>();
    try {
      const cleaned = response.replace(/```json/gi, '').replace(/```/g, '').trim();

      // 1. Try parsing JSON array or JSON object
      const jsonMatch = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/) || cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            const id = entry.id ?? entry.sequenceId;
            const trans = entry.translation ?? entry.text ?? entry.translatedText;
            if (id !== undefined && typeof trans === 'string' && trans.trim()) {
              result.set(Number(id), trans.trim());
            }
          }
          if (result.size > 0) return result;
        } else if (typeof parsed === 'object' && parsed !== null) {
          for (const [key, val] of Object.entries(parsed)) {
            const numKey = Number(key);
            if (!isNaN(numKey) && typeof val === 'string' && val.trim()) {
              result.set(numKey, val.trim());
            }
          }
          if (result.size > 0) return result;
        }
      }

      // 2. Try parsing line-by-line structured format "id: translation" or "101. translation"
      const lines = cleaned.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        const match = line.match(/^(?:\[?(\d+)\]?|(\d+)[\.:：])\s*(.+)$/);
        if (match) {
          const id = Number(match[1] || match[2]);
          const trans = match[3].trim();
          if (!isNaN(id) && trans) {
            result.set(id, trans);
          }
        }
      }

      // 3. Fallback: if lines count matches items count, map in order
      if (result.size === 0 && lines.length === items.length) {
        for (let i = 0; i < items.length; i++) {
          result.set(items[i].id, lines[i]);
        }
      }
    } catch (e) {
      console.warn('[Scheduler] Batch parse fallback triggered:', e);
    }
    return result;
  }

  /**
   * Enqueue a translation request. Performs micro-batching for short segments.
   */
  public enqueue(options: EnqueueTaskOptions): Promise<string | null> {
    if (options.signal?.aborted) {
      return Promise.resolve(null);
    }

    const wordCount = countEnglishWords(options.text);
    const isShort = wordCount < SHORT_SEGMENT_THRESHOLD;

    translationDiagnosticLogger.stageBatchSegmentReceived(options.sequenceId, wordCount);

    return new Promise((resolve, reject) => {
      if (isShort) {
        this.pendingBatchItems.push({
          options,
          resolve,
          reject,
          addedAt: Date.now(),
        });

        const pendingCount = this.pendingBatchItems.length;
        const totalCombinedWords = this.pendingBatchItems.reduce(
          (sum, item) => sum + countEnglishWords(item.options.text),
          0
        );

        translationDiagnosticLogger.stageBatchPending(options.sequenceId, pendingCount, totalCombinedWords);

        if (totalCombinedWords >= SHORT_SEGMENT_THRESHOLD) {
          this.flushPendingBatch('word_threshold');
        } else if (pendingCount >= MAX_BATCH_SEGMENTS) {
          this.flushPendingBatch('segment_limit');
        } else if (pendingCount === 1 && !this.batchTimer) {
          this.batchTimer = setTimeout(() => {
            this.flushPendingBatch('timeout');
          }, MAX_BATCH_WAIT_MS);
        }
      } else {
        // Long segment (>= 20 words)
        if (this.pendingBatchItems.length > 0) {
          // If pending short segments exist, group long segment together with pending short segments if safe
          if (this.pendingBatchItems.length < MAX_BATCH_SEGMENTS) {
            this.pendingBatchItems.push({
              options,
              resolve,
              reject,
              addedAt: Date.now(),
            });
            this.flushPendingBatch('long_segment');
            return;
          } else {
            this.flushPendingBatch('long_segment');
          }
        }
        this.enqueueInternal({ options, resolve, reject, attempts: 0 });
      }
    });
  }


  private enqueueInternal(item: QueuedItem): void {
    // Check queue bounds
    if (this.queue.length >= this.maxQueueSize) {
      const dropped = this.queue.shift();
      if (dropped) {
        dropped.resolve(null);
      }
    }

    this.queue.push(item);

    translationDiagnosticLogger.stageEnqueue(
      item.options.sequenceId,
      this.queue.length,
      this.activeCount,
      item.options.text.length
    );
    translationStatsTracker.updateQueueDepth(this.queue.length);

    this.scheduleNext();
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

          translationDiagnosticLogger.stageDequeue(
            item.options.sequenceId,
            this.queue.length,
            this.activeCount
          );
          translationStatsTracker.updateQueueDepth(this.queue.length);

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

  private cleanTranslationText(raw: string): string {
    return raw
      .trim()
      .replace(/^[*\-•#\s:]+/, '')
      .replace(/^翻译[:：]\s*/, '')
      .replace(/^Translation[:：]\s*/i, '')
      .trim();
  }

  private async executeTask(item: QueuedItem): Promise<void> {
    const { text, apiKey, signal } = item.options;
    const trimmed = text.trim();

    if (!trimmed || (!apiKey && !this.backendTranslateGroqFn && !this.backendTranslateGeminiFn && !this.fetchFn)) {
      item.resolve(null);
      return;
    }

    if (signal?.aborted) {
      item.resolve(null);
      return;
    }

    // =========================================================================
    // STAGE 1: PRIMARY PROVIDER — GROQ (via Native Backend)
    // =========================================================================
    const seq = item.options.sequenceId;
    let groqFailed = false;

    if (this.backendTranslateGroqFn && !this.isGroqDisabledForSession) {
      let availableGroqModels = GROQ_CANDIDATE_MODELS.filter(m => !this.disabledGroqModels.has(m));
      if (availableGroqModels.length === 0) {
        // Clear model disable filter on new segment if provider itself is not disabled for session
        this.disabledGroqModels.clear();
        availableGroqModels = [...GROQ_CANDIDATE_MODELS];
      }

      if (availableGroqModels.length > 0) {
        const preferredGroq = GROQ_CANDIDATE_MODELS[this.preferredGroqModelIndex];
        const orderedGroqModels = [
          ...(availableGroqModels.includes(preferredGroq) ? [preferredGroq] : []),
          ...availableGroqModels.filter(m => m !== preferredGroq),
        ];

        for (const model of orderedGroqModels) {
          if (signal?.aborted) {
            item.resolve(null);
            return;
          }

          try {
            translationDiagnosticLogger.stageProviderSelect('groq', model, seq);
            translationDiagnosticLogger.stageCredential('groq', true, seq);
            translationDiagnosticLogger.stageRequest('groq', model, seq, 0, trimmed.length);
            translationStatsTracker.recordGroqRequestStart();

            const groqStart = Date.now();
            const candidate = await this.backendTranslateGroqFn(trimmed, model, signal);

            if (typeof candidate === 'string' && candidate.trim()) {
              const cleaned = this.cleanTranslationText(candidate);
              if (cleaned) {
                const latencyMs = Date.now() - groqStart;
                translationDiagnosticLogger.stageSuccess('groq', model, seq, latencyMs, cleaned.length);
                translationStatsTracker.recordGroqSuccess(latencyMs);

                this.consecutive429s = 0;
                const idx = GROQ_CANDIDATE_MODELS.indexOf(model);
                if (idx !== -1) {
                  this.preferredGroqModelIndex = idx;
                }
                item.resolve(cleaned);
                return;
              }
            }
            translationDiagnosticLogger.stageHttpError('groq', model, seq, 200, 'empty_response');
            translationStatsTracker.recordGroqOtherError();
          } catch (err: unknown) {
            if (signal?.aborted) {
              item.resolve(null);
              return;
            }

            groqFailed = true;
            const category = classifyTranslationError(err);
            const errStr = String((err as { message?: string })?.message || err || '');
            const statusMatch = errStr.match(/HTTP\s+(\d+)/);
            const status = statusMatch ? parseInt(statusMatch[1], 10) : (category === 'rate_limited_429' ? 429 : 500);

            translationDiagnosticLogger.stageHttpError('groq', model, seq, status, category);

            if (category === 'unauthorized_401' || category === 'forbidden_403' || category === 'credential_missing') {
              translationStatsTracker.recordGroqAuthError();
              this.isGroqDisabledForSession = true;
              break; // Fall through to Gemini
            }

            if (category === 'rate_limited_429') {
              translationStatsTracker.recordGroq429();
              this.consecutive429s++;
              const backoffMs = Math.min(15000, Math.pow(2, this.consecutive429s) * 1000);
              this.cooldownUntil = Date.now() + backoffMs;
              break; // Fall through to Gemini for instant subtitle delivery
            }

            if (category === 'model_not_found_404') {
              translationStatsTracker.recordGroqOtherError();
              this.disabledGroqModels.add(model);
              continue;
            }

            translationStatsTracker.recordGroqOtherError();
          }
        }
      }
    }

    // =========================================================================
    // STAGE 2: FALLBACK PROVIDER — GEMINI (Native Backend or Fetch)
    // =========================================================================
    if (!this.isGeminiDisabledForSession) {
      let availableGeminiModels = GEMINI_CANDIDATE_MODELS.filter(m => !this.disabledGeminiModels.has(m));
      if (availableGeminiModels.length === 0) {
        // Clear model disable filter on new segment if provider itself is not disabled for session
        this.disabledGeminiModels.clear();
        availableGeminiModels = [...GEMINI_CANDIDATE_MODELS];
      }

      if (availableGeminiModels.length > 0) {
        if (groqFailed || this.backendTranslateGroqFn) {
          translationDiagnosticLogger.stageFallback('groq', 'gemini', seq);
          translationStatsTracker.recordGeminiFallbackAttempt();
        }

        const preferredGemini = GEMINI_CANDIDATE_MODELS[this.preferredGeminiModelIndex];
        const orderedGeminiModels = [
          ...(availableGeminiModels.includes(preferredGemini) ? [preferredGemini] : []),
          ...availableGeminiModels.filter(m => m !== preferredGemini),
        ];

        for (const model of orderedGeminiModels) {
          if (signal?.aborted) {
            item.resolve(null);
            return;
          }

          // 1. Prioritize Rust backend invocation if configured
          if (this.backendTranslateGeminiFn) {
            try {
              translationDiagnosticLogger.stageProviderSelect('gemini', model, seq);
              translationDiagnosticLogger.stageCredential('gemini', true, seq);
              translationDiagnosticLogger.stageRequest('gemini', model, seq, item.attempts, trimmed.length);

              const geminiStart = Date.now();
              const candidate = await this.backendTranslateGeminiFn(trimmed, model, signal);

              if (typeof candidate === 'string' && candidate.trim()) {
                const cleaned = this.cleanTranslationText(candidate);
                if (cleaned) {
                  const latencyMs = Date.now() - geminiStart;
                  translationDiagnosticLogger.stageSuccess('gemini', model, seq, latencyMs, cleaned.length);
                  translationStatsTracker.recordGeminiSuccess(latencyMs);

                  this.consecutive429s = 0;
                  const idx = GEMINI_CANDIDATE_MODELS.indexOf(model);
                  if (idx !== -1) {
                    this.preferredGeminiModelIndex = idx;
                  }
                  item.resolve(cleaned);
                  return;
                }
              }
            } catch (err: unknown) {
              if (signal?.aborted) {
                item.resolve(null);
                return;
              }

              const category = classifyTranslationError(err);
              const errStr = String((err as { message?: string })?.message || err || '');
              const statusMatch = errStr.match(/HTTP\s+(\d+)/);
              const status = statusMatch ? parseInt(statusMatch[1], 10) : (category === 'rate_limited_429' ? 429 : 500);

              translationDiagnosticLogger.stageHttpError('gemini', model, seq, status, category);
              translationStatsTracker.recordGeminiFailure();

              if (category === 'unauthorized_401' || category === 'forbidden_403' || category === 'credential_missing') {
                this.isGeminiDisabledForSession = true;
                item.resolve(null);
                return;
              }

              if (category === 'rate_limited_429') {
                this.consecutive429s++;
                const backoffMs = Math.min(30000, Math.pow(2, this.consecutive429s) * 1000);
                this.cooldownUntil = Date.now() + backoffMs;
                if (item.attempts < 3) {
                  item.attempts++;
                  this.queue.unshift(item);
                } else {
                  item.resolve(null);
                }
                return;
              }

              if (category === 'model_not_found_404' || category === 'bad_request_400') {
                this.disabledGeminiModels.add(model);
                continue;
              }

              continue;
            }
          }

        // 2. Fetch API fallback (for unit tests / mock environment)
        if (this.fetchFn) {
          try {
            translationDiagnosticLogger.stageProviderSelect('gemini', model, seq);
            translationDiagnosticLogger.stageCredential('gemini', !!apiKey, seq);
            translationDiagnosticLogger.stageRequest('gemini', model, seq, item.attempts, trimmed.length);

            const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.requestTimeoutMs);

            const onAbort = () => controller.abort();
            signal?.addEventListener('abort', onAbort);

            const geminiStart = Date.now();
            const response = await this.fetchFn(endpoint, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey ?? '',
              },
              signal: controller.signal,
              body: JSON.stringify({
                contents: [{ parts: [{ text: trimmed }] }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
              }),
            });

            clearTimeout(timeoutId);
            signal?.removeEventListener('abort', onAbort);

            if (response.status === 401 || response.status === 403) {
              translationDiagnosticLogger.stageHttpError('gemini', model, seq, response.status, 'unauthorized_401');
              translationStatsTracker.recordGeminiFailure();
              item.resolve(null);
              return;
            }

            if (response.status === 429) {
              translationDiagnosticLogger.stageHttpError('gemini', model, seq, 429, 'rate_limited_429');
              translationStatsTracker.recordGeminiFailure();
              this.consecutive429s++;
              const backoffMs = Math.min(30000, Math.pow(2, this.consecutive429s) * 1000);
              this.cooldownUntil = Date.now() + backoffMs;
              if (item.attempts < 3) {
                item.attempts++;
                this.queue.unshift(item);
              } else {
                item.resolve(null);
              }
              return;
            }

            if (response.status === 404 || response.status === 400) {
              translationDiagnosticLogger.stageHttpError('gemini', model, seq, response.status, 'model_not_found_404');
              this.disabledGeminiModels.add(model);
              continue;
            }

            if (!response.ok) {
              translationDiagnosticLogger.stageHttpError('gemini', model, seq, response.status, 'server_5xx');
              translationStatsTracker.recordGeminiFailure();
              continue;
            }

            this.consecutive429s = 0;
            const data = await response.json();
            const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

            if (typeof candidateText === 'string' && candidateText.trim()) {
              const latencyMs = Date.now() - geminiStart;
              const cleaned = this.cleanTranslationText(candidateText);
              translationDiagnosticLogger.stageSuccess('gemini', model, seq, latencyMs, (cleaned || candidateText.trim()).length);
              translationStatsTracker.recordGeminiSuccess(latencyMs);

              const idx = GEMINI_CANDIDATE_MODELS.indexOf(model);
              if (idx !== -1) {
                this.preferredGeminiModelIndex = idx;
              }
              item.resolve(cleaned || candidateText.trim());
              return;
            }
          } catch (err) {
            if (signal?.aborted) {
              item.resolve(null);
              return;
            }
            const category = classifyTranslationError(err);
            translationDiagnosticLogger.stageHttpError('gemini', model, seq, 0, category);
            translationStatsTracker.recordGeminiFailure();
            continue;
          }
        }
      }
    }
    }

    // All providers exhausted
    translationDiagnosticLogger.stageAllProvidersFailed(seq, 'unknown');
    translationStatsTracker.recordAllProvidersFailed();
    item.resolve(null);
  }
}

// Global shared scheduler instance
export const unifiedTranslationScheduler = new UnifiedTranslationScheduler();
