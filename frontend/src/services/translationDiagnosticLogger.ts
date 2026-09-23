/**
 * Translation Diagnostic Logger for Meetily Bilingual
 *
 * Provides persistent, privacy-preserving, rotating diagnostic logs.
 * Strictly adheres to privacy and secrecy guidelines:
 * - NEVER logs API keys, Authorization headers, English transcript text, or Chinese translation text.
 * - Formats logs with prefix 'BILINGUAL-TRANSLATION' and traces sequence_id where available.
 * - Dispatches asynchronously to the Rust backend without blocking UI, ASR, or audio processing.
 */

export type DiagnosticLogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

export type TranslationFailureCategory =
  | 'credential_missing'
  | 'credential_read_error'
  | 'unauthorized_401'
  | 'forbidden_403'
  | 'rate_limited_429'
  | 'bad_request_400'
  | 'model_not_found_404'
  | 'server_5xx'
  | 'timeout'
  | 'network_error'
  | 'invalid_json'
  | 'empty_response'
  | 'provider_disabled'
  | 'queue_rejected'
  | 'unknown';

export interface TranslationLogEvent {
  level: DiagnosticLogLevel;
  stage:
    | 'eligible'
    | 'skipped'
    | 'enqueue'
    | 'dequeue'
    | 'provider_select'
    | 'credential'
    | 'request'
    | 'success'
    | 'http_error'
    | 'fallback'
    | 'all_providers_failed'
    | 'tracker_commit'
    | 'map_update'
    | 'ui_rendered'
    | 'batch_segment_received'
    | 'batch_pending'
    | 'batch_flush'
    | 'batch_request'
    | 'batch_success'
    | 'batch_partial_mapping';
  sequenceId?: number;
  provider?: 'groq' | 'gemini';
  model?: string;
  textLen?: number;
  outputLen?: number;
  queueLen?: number;
  activeCount?: number;
  status?: number;
  latencyMs?: number;
  retry?: number;
  cooldownMs?: number;
  fromProvider?: string;
  toProvider?: string;
  credentialAvailable?: boolean;
  category?: TranslationFailureCategory;
  reason?: string;
  details?: Record<string, string | number | boolean | undefined>;
}

/**
 * Normalizes any error object or message into a safe failure category.
 * Absolutely strips any secret tokens or raw payloads.
 */
export function classifyTranslationError(error: unknown): TranslationFailureCategory {
  if (!error) return 'unknown';

  const errStr = typeof error === 'string' ? error : (error as { message?: string })?.message || String(error);

  if (/not configured|api key.*missing|no api key|key.*not found|unconfigured/i.test(errStr)) {
    return 'credential_missing';
  }
  if (/keyring|credential store|read-back/i.test(errStr)) {
    return 'credential_read_error';
  }
  if (/401|unauthorized|invalid api key/i.test(errStr)) {
    return 'unauthorized_401';
  }
  if (/403|forbidden/i.test(errStr)) {
    return 'forbidden_403';
  }
  if (/429|rate limit|quota exceeded|resource exhausted/i.test(errStr)) {
    return 'rate_limited_429';
  }
  if (/404|model.*not found/i.test(errStr)) {
    return 'model_not_found_404';
  }
  if (/400|bad request/i.test(errStr)) {
    return 'bad_request_400';
  }
  if (/500|502|503|504|internal server error|service unavailable|bad gateway/i.test(errStr)) {
    return 'server_5xx';
  }
  if (/timeout|aborted|timed out|deadline exceeded/i.test(errStr)) {
    return 'timeout';
  }
  if (/network|connection refused|failed to fetch|econnrefused|econnreset/i.test(errStr)) {
    return 'network_error';
  }
  if (/json|syntaxerror|unexpected token/i.test(errStr)) {
    return 'invalid_json';
  }
  if (/empty response|no choices/i.test(errStr)) {
    return 'empty_response';
  }
  if (/disabled for session/i.test(errStr)) {
    return 'provider_disabled';
  }

  return 'unknown';
}

/**
 * Redacts any accidental API key patterns from log metadata strings.
 */
export function sanitizeLogString(str: string): string {
  return str
    .replace(/Bearer\s+[A-Za-z0-9_\-\.]+/gi, 'Bearer [REDACTED]')
    .replace(/gsk_[A-Za-z0-9_\-]+/g, '[REDACTED_GROQ_KEY]')
    .replace(/AIza[A-Za-z0-9_\-]+/g, '[REDACTED_GEMINI_KEY]');
}

class TranslationDiagnosticLogger {
  private isTauri: boolean | null = null;

  private checkTauri(): boolean {
    if (this.isTauri === null) {
      this.isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
    }
    return this.isTauri;
  }

  /**
   * Log a structured translation lifecycle event.
   */
  public log(event: TranslationLogEvent): void {
    const timestamp = new Date().toISOString();
    const parts: string[] = [
      timestamp,
      event.level,
      'BILINGUAL-TRANSLATION',
    ];

    if (event.sequenceId !== undefined) {
      parts.push(`seq=${event.sequenceId}`);
    }

    if (event.provider) {
      parts.push(`provider=${event.provider}`);
    }

    if (event.model) {
      parts.push(`model=${event.model}`);
    }

    parts.push(`stage=${event.stage}`);

    if (event.textLen !== undefined) {
      parts.push(`text_len=${event.textLen}`);
    }

    if (event.outputLen !== undefined) {
      parts.push(`output_len=${event.outputLen}`);
    }

    if (event.queueLen !== undefined) {
      parts.push(`queue=${event.queueLen}`);
    }

    if (event.activeCount !== undefined) {
      parts.push(`active=${event.activeCount}`);
    }

    if (event.status !== undefined) {
      parts.push(`status=${event.status}`);
    }

    if (event.latencyMs !== undefined) {
      parts.push(`latency_ms=${event.latencyMs}`);
    }

    if (event.retry !== undefined) {
      parts.push(`retry=${event.retry}`);
    }

    if (event.cooldownMs !== undefined) {
      parts.push(`cooldown_ms=${event.cooldownMs}`);
    }

    if (event.fromProvider && event.toProvider) {
      parts.push(`from=${event.fromProvider} to=${event.toProvider}`);
    }

    if (event.credentialAvailable !== undefined) {
      parts.push(`credential_available=${event.credentialAvailable}`);
    }

    if (event.category) {
      parts.push(`category=${event.category}`);
    }

    if (event.reason) {
      parts.push(`reason=${sanitizeLogString(event.reason)}`);
    }

    if (event.details) {
      for (const [k, v] of Object.entries(event.details)) {
        if (v !== undefined) {
          parts.push(`${k}=${sanitizeLogString(String(v))}`);
        }
      }
    }

    const logLine = parts.join(' ');

    // 1. Console log (sanitized)
    if (event.level === 'ERROR') {
      console.error(logLine);
    } else if (event.level === 'WARN') {
      console.warn(logLine);
    } else {
      console.log(logLine);
    }

    // 2. Dispatch asynchronously to Rust persistent rotating log (non-blocking)
    if (this.checkTauri()) {
      import('@tauri-apps/api/core')
        .then(({ invoke }) => {
          invoke('api_write_translation_log_line', { line: logLine }).catch(() => {
            // Ignore background log write failures
          });
        })
        .catch(() => {
          // Ignore import failure
        });
    }
  }

  // --- Convenience Stage Loggers ---

  public stageEligible(sequenceId: number, textLen: number, isPartial: boolean): void {
    this.log({
      level: 'INFO',
      stage: 'eligible',
      sequenceId,
      textLen,
      details: { is_partial: isPartial },
    });
  }

  public stageSkipped(sequenceId: number, reason: string, isPartial: boolean, textLen: number): void {
    this.log({
      level: 'DEBUG',
      stage: 'skipped',
      sequenceId,
      textLen,
      reason,
      details: { is_partial: isPartial },
    });
  }

  public stageEnqueue(sequenceId: number | undefined, queueLen: number, activeCount: number, textLen: number): void {
    this.log({
      level: 'INFO',
      stage: 'enqueue',
      sequenceId,
      queueLen,
      activeCount,
      textLen,
    });
  }

  public stageDequeue(sequenceId: number | undefined, queueLen: number, activeCount: number): void {
    this.log({
      level: 'DEBUG',
      stage: 'dequeue',
      sequenceId,
      queueLen,
      activeCount,
    });
  }

  public stageProviderSelect(provider: 'groq' | 'gemini', model: string, sequenceId?: number): void {
    this.log({
      level: 'INFO',
      stage: 'provider_select',
      sequenceId,
      provider,
      model,
    });
  }

  public stageCredential(provider: 'groq' | 'gemini', available: boolean, sequenceId?: number): void {
    this.log({
      level: available ? 'DEBUG' : 'WARN',
      stage: 'credential',
      sequenceId,
      provider,
      credentialAvailable: available,
    });
  }

  public stageRequest(provider: 'groq' | 'gemini', model: string, sequenceId?: number, retry = 0, textLen?: number): void {
    this.log({
      level: 'INFO',
      stage: 'request',
      sequenceId,
      provider,
      model,
      retry,
      textLen,
    });
  }

  public stageSuccess(provider: 'groq' | 'gemini', model: string, sequenceId: number | undefined, latencyMs: number, outputLen: number): void {
    this.log({
      level: 'INFO',
      stage: 'success',
      sequenceId,
      provider,
      model,
      latencyMs,
      outputLen,
    });
  }

  public stageHttpError(provider: 'groq' | 'gemini', model: string, sequenceId: number | undefined, status: number, category: TranslationFailureCategory): void {
    this.log({
      level: 'WARN',
      stage: 'http_error',
      sequenceId,
      provider,
      model,
      status,
      category,
    });
  }

  public stageFallback(fromProvider: string, toProvider: string, sequenceId?: number, reason?: string): void {
    this.log({
      level: 'INFO',
      stage: 'fallback',
      sequenceId,
      fromProvider,
      toProvider,
      reason,
    });
  }

  public stageAllProvidersFailed(sequenceId?: number, category?: TranslationFailureCategory): void {
    this.log({
      level: 'ERROR',
      stage: 'all_providers_failed',
      sequenceId,
      category,
    });
  }

  public stageTrackerCommit(sequenceId: number, accepted: boolean, version: number): void {
    this.log({
      level: 'DEBUG',
      stage: 'tracker_commit',
      sequenceId,
      details: { accepted, version },
    });
  }

  public stageMapUpdate(sequenceId: number, mapCount?: number): void {
    this.log({
      level: 'INFO',
      stage: 'map_update',
      sequenceId,
      details: mapCount !== undefined ? { map_count: mapCount } : undefined,
    });
  }

  public stageUiRendered(sequenceId: number): void {
    this.log({
      level: 'DEBUG',
      stage: 'ui_rendered',
      sequenceId,
    });
  }

  public stageBatchSegmentReceived(sequenceId: number | undefined, wordCount: number): void {
    this.log({
      level: 'INFO',
      stage: 'batch_segment_received',
      sequenceId,
      details: { word_count: wordCount },
    });
  }

  public stageBatchPending(sequenceId: number | undefined, pendingCount: number, pendingWordCount: number): void {
    this.log({
      level: 'DEBUG',
      stage: 'batch_pending',
      sequenceId,
      details: { pending_count: pendingCount, pending_word_count: pendingWordCount },
    });
  }

  public stageBatchFlush(
    reason: 'word_threshold' | 'segment_limit' | 'timeout' | 'long_segment' | 'session_stop',
    segmentCount: number,
    totalWordCount: number,
    oldestWaitMs?: number
  ): void {
    this.log({
      level: 'INFO',
      stage: 'batch_flush',
      reason,
      details: {
        segment_count: segmentCount,
        total_word_count: totalWordCount,
        ...(oldestWaitMs !== undefined ? { oldest_wait_ms: oldestWaitMs } : {}),
      },
    });
  }

  public stageBatchRequest(segmentCount: number): void {
    this.log({
      level: 'INFO',
      stage: 'batch_request',
      details: { segment_count: segmentCount },
    });
  }

  public stageBatchSuccess(requestedCount: number, mappedCount: number): void {
    this.log({
      level: 'INFO',
      stage: 'batch_success',
      details: { requested_count: requestedCount, mapped_count: mappedCount },
    });
  }

  public stageBatchPartialMapping(requestedCount: number, mappedCount: number, fallbackCount: number): void {
    this.log({
      level: 'WARN',
      stage: 'batch_partial_mapping',
      details: {
        requested_count: requestedCount,
        mapped_count: mappedCount,
        fallback_count: fallbackCount,
      },
    });
  }
}

export const translationDiagnosticLogger = new TranslationDiagnosticLogger();
