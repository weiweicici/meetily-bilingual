/**
 * TranslationSessionTracker
 *
 * Manages translation request identity, versioning, session isolation,
 * and concurrency tracking across real-time and historical sessions.
 */

export interface TranslationTask {
  sessionId: string;
  sequenceId: number | string;
  text: string;
  version: number;
  status: 'in-flight' | 'completed' | 'failed';
  attempts: number;
  translation?: string;
}

export class TranslationSessionTracker {
  private currentSessionId: string;
  private tasks: Map<string, TranslationTask> = new Map();
  private maxAttempts: number;

  constructor(initialSessionId?: string, maxAttempts = 3) {
    this.currentSessionId = initialSessionId || this.generateSessionId();
    this.maxAttempts = maxAttempts;
  }

  public generateSessionId(): string {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  public getSessionId(): string {
    return this.currentSessionId;
  }

  public resetSession(newSessionId?: string): string {
    this.currentSessionId = newSessionId || this.generateSessionId();
    this.tasks.clear();
    return this.currentSessionId;
  }

  private getTaskKey(sequenceId: number | string): string {
    return `${this.currentSessionId}:${sequenceId}`;
  }

  /**
   * Evaluates whether a translation should be requested for this segment.
   * Enforces:
   * 1. Rejects partial hypotheses (isPartial === true).
   * 2. Rejects empty text.
   * 3. Deduplicates identical completed or in-flight text.
   * 4. Allows revisions: if text changes for the same sequenceId, supersedes older version.
   * 5. Enforces attempt limit on failed items.
   */
  public shouldRequest(
    sequenceId: number | string,
    text: string,
    isPartial = false
  ): { shouldRequest: boolean; sessionId: string; version: number } {
    if (isPartial) {
      return { shouldRequest: false, sessionId: this.currentSessionId, version: 0 };
    }

    const trimmed = text.trim();
    if (!trimmed) {
      return { shouldRequest: false, sessionId: this.currentSessionId, version: 0 };
    }

    const key = this.getTaskKey(sequenceId);
    const existing = this.tasks.get(key);

    if (existing) {
      // If text is identical:
      if (existing.text === trimmed) {
        if (existing.status === 'completed' || existing.status === 'in-flight') {
          return { shouldRequest: false, sessionId: this.currentSessionId, version: existing.version };
        }
        if (existing.status === 'failed' && existing.attempts >= this.maxAttempts) {
          return { shouldRequest: false, sessionId: this.currentSessionId, version: existing.version };
        }
        // Retry failed with same text
        existing.status = 'in-flight';
        return { shouldRequest: true, sessionId: this.currentSessionId, version: existing.version };
      }

      // Text was revised! Increment version to supersede old in-flight / completed
      const newVersion = existing.version + 1;
      this.tasks.set(key, {
        sessionId: this.currentSessionId,
        sequenceId,
        text: trimmed,
        version: newVersion,
        status: 'in-flight',
        attempts: 0,
      });
      return { shouldRequest: true, sessionId: this.currentSessionId, version: newVersion };
    }

    // New task
    this.tasks.set(key, {
      sessionId: this.currentSessionId,
      sequenceId,
      text: trimmed,
      version: 1,
      status: 'in-flight',
      attempts: 0,
    });

    return { shouldRequest: true, sessionId: this.currentSessionId, version: 1 };
  }

  /**
   * Commits the result of a translation.
   * Returns true if accepted, false if discarded (superseded, wrong session, or cancelled).
   */
  public commitResult(
    sessionId: string,
    sequenceId: number | string,
    version: number,
    translation: string | null
  ): boolean {
    // Session isolation: reject responses from old or different sessions
    if (sessionId !== this.currentSessionId) {
      return false;
    }

    const key = this.getTaskKey(sequenceId);
    const task = this.tasks.get(key);
    if (!task) {
      return false;
    }

    // Version check: reject older responses that were superseded by revisions
    if (task.version !== version) {
      return false;
    }

    if (translation && translation.trim()) {
      task.status = 'completed';
      task.translation = translation.trim();
      return true;
    }

    task.status = 'failed';
    task.attempts += 1;
    return false;
  }

  public getTranslation(sequenceId: number | string): string | undefined {
    const key = this.getTaskKey(sequenceId);
    return this.tasks.get(key)?.translation;
  }

  public inFlightCount(): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.status === 'in-flight') {
        count++;
      }
    }
    return count;
  }

  public hasInFlight(): boolean {
    return this.inFlightCount() > 0;
  }
}
