/**
 * Translation Statistics Tracker for Meetily Bilingual
 *
 * Maintains lightweight in-memory session statistics and real-time health indicator state.
 * Strictly adheres to privacy guidelines: NEVER stores transcript text or credentials.
 * Resets automatically when a new recording session begins.
 */

export type TranslationHealthStatus =
  | 'idle'
  | 'groq_success'
  | 'groq_inflight'
  | 'groq_429'
  | 'gemini_fallback'
  | 'all_failed';

export interface SessionTranslationStats {
  totalEligible: number;
  groqRequests: number;
  groqSuccesses: number;
  groq429Count: number;
  groqAuthErrorCount: number;
  groqOtherErrors: number;
  geminiFallbackAttempts: number;
  geminiSuccesses: number;
  geminiFailures: number;
  allProviderFailures: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  currentQueueDepth: number;
  maxQueueDepth: number;
  successRatePct: number;
  current60sRpm: number;
  peak60sRpm: number;
  batchedSegments: number;
  savedApiRequests: number;
  currentHealth: TranslationHealthStatus;
  lastUpdated: number;
}

type StatsListener = (stats: SessionTranslationStats) => void;

class TranslationStatsTracker {
  private totalEligible = 0;
  private groqRequests = 0;
  private groqSuccesses = 0;
  private groq429Count = 0;
  private groqAuthErrorCount = 0;
  private groqOtherErrors = 0;
  private geminiFallbackAttempts = 0;
  private geminiSuccesses = 0;
  private geminiFailures = 0;
  private allProviderFailures = 0;
  private latencies: number[] = [];
  private currentQueueDepth = 0;
  private maxQueueDepth = 0;
  private currentHealth: TranslationHealthStatus = 'idle';
  private lastUpdated = Date.now();
  private listeners: Set<StatsListener> = new Set();

  // Micro-batching and 60s RPM metrics
  private requestTimestamps: number[] = [];
  private peak60sRpm = 0;
  private batchedSegments = 0;
  private savedApiRequests = 0;

  /**
   * Reset all counters for a new recording session.
   */
  public reset(): void {
    this.totalEligible = 0;
    this.groqRequests = 0;
    this.groqSuccesses = 0;
    this.groq429Count = 0;
    this.groqAuthErrorCount = 0;
    this.groqOtherErrors = 0;
    this.geminiFallbackAttempts = 0;
    this.geminiSuccesses = 0;
    this.geminiFailures = 0;
    this.allProviderFailures = 0;
    this.latencies = [];
    this.currentQueueDepth = 0;
    this.maxQueueDepth = 0;
    this.currentHealth = 'idle';
    this.lastUpdated = Date.now();
    this.requestTimestamps = [];
    this.peak60sRpm = 0;
    this.batchedSegments = 0;
    this.savedApiRequests = 0;
    this.notify();
  }

  public recordEligibleSegment(): void {
    this.totalEligible++;
    this.lastUpdated = Date.now();
    this.notify();
  }

  public recordBatchedSegments(count: number): void {
    if (count > 1) {
      this.batchedSegments += count;
      this.savedApiRequests += (count - 1);
      this.lastUpdated = Date.now();
      this.notify();
    }
  }

  public updateQueueDepth(depth: number): void {
    this.currentQueueDepth = depth;
    if (depth > this.maxQueueDepth) {
      this.maxQueueDepth = depth;
    }
    this.lastUpdated = Date.now();
    this.notify();
  }

  public recordHttpRequestExecuted(): void {
    const now = Date.now();
    this.requestTimestamps.push(now);
    const windowStart = now - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(t => t >= windowStart);
    const currentRpm = this.requestTimestamps.length;
    if (currentRpm > this.peak60sRpm) {
      this.peak60sRpm = currentRpm;
    }
  }

  public recordGroqRequestStart(): void {
    this.groqRequests++;
    this.recordHttpRequestExecuted();
    this.currentHealth = 'groq_inflight';
    this.lastUpdated = Date.now();
    this.notify();
  }

  public recordGroqSuccess(latencyMs: number): void {
    this.groqSuccesses++;
    this.latencies.push(latencyMs);
    this.currentHealth = 'groq_success';
    this.lastUpdated = Date.now();
    this.notify();
  }

  public recordGroq429(): void {
    this.groq429Count++;
    this.currentHealth = 'groq_429';
    this.lastUpdated = Date.now();
    this.notify();
  }

  public recordGroqAuthError(): void {
    this.groqAuthErrorCount++;
    this.lastUpdated = Date.now();
    this.notify();
  }

  public recordGroqOtherError(): void {
    this.groqOtherErrors++;
    this.lastUpdated = Date.now();
    this.notify();
  }

  public recordGeminiFallbackAttempt(): void {
    this.geminiFallbackAttempts++;
    this.recordHttpRequestExecuted();
    this.currentHealth = 'gemini_fallback';
    this.lastUpdated = Date.now();
    this.notify();
  }

  public recordGeminiSuccess(latencyMs: number): void {
    this.geminiSuccesses++;
    this.latencies.push(latencyMs);
    this.currentHealth = 'gemini_fallback';
    this.lastUpdated = Date.now();
    this.notify();
  }

  public recordGeminiFailure(): void {
    this.geminiFailures++;
    this.lastUpdated = Date.now();
    this.notify();
  }

  public recordAllProvidersFailed(): void {
    this.allProviderFailures++;
    this.currentHealth = 'all_failed';
    this.lastUpdated = Date.now();
    this.notify();
  }

  public setHealth(health: TranslationHealthStatus): void {
    this.currentHealth = health;
    this.lastUpdated = Date.now();
    this.notify();
  }

  public getStats(): SessionTranslationStats {
    const totalSuccess = this.groqSuccesses + this.geminiSuccesses;
    const totalAttempts = this.totalEligible > 0 ? this.totalEligible : (this.groqRequests + this.allProviderFailures);
    const successRatePct = totalAttempts > 0 ? Math.round((totalSuccess / totalAttempts) * 100) : 100;

    const now = Date.now();
    const windowStart = now - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(t => t >= windowStart);
    const current60sRpm = this.requestTimestamps.length;

    const avgLatencyMs =
      this.latencies.length > 0
        ? Math.round(this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length)
        : 0;
    const maxLatencyMs =
      this.latencies.length > 0 ? Math.max(...this.latencies) : 0;

    return {
      totalEligible: this.totalEligible,
      groqRequests: this.groqRequests,
      groqSuccesses: this.groqSuccesses,
      groq429Count: this.groq429Count,
      groqAuthErrorCount: this.groqAuthErrorCount,
      groqOtherErrors: this.groqOtherErrors,
      geminiFallbackAttempts: this.geminiFallbackAttempts,
      geminiSuccesses: this.geminiSuccesses,
      geminiFailures: this.geminiFailures,
      allProviderFailures: this.allProviderFailures,
      avgLatencyMs,
      maxLatencyMs,
      currentQueueDepth: this.currentQueueDepth,
      maxQueueDepth: this.maxQueueDepth,
      successRatePct,
      current60sRpm,
      peak60sRpm: this.peak60sRpm,
      batchedSegments: this.batchedSegments,
      savedApiRequests: this.savedApiRequests,
      currentHealth: this.currentHealth,
      lastUpdated: this.lastUpdated,
    };
  }

  public formatMarkdownSummary(): string {
    const s = this.getStats();
    return [
      `### 🎙️ Meetily Bilingual — 会话实时翻译统计报告`,
      `- 统计时间: ${new Date().toLocaleString()}`,
      `- 总可翻译段落数: ${s.totalEligible}`,
      `- 总体翻译成功率: ${s.successRatePct}%`,
      `- 平均延迟: ${s.avgLatencyMs} ms | 最大延迟: ${s.maxLatencyMs} ms`,
      `- 60秒请求频率: 当前 ${s.current60sRpm} RPM | 峰值 ${s.peak60sRpm} RPM`,
      `- 批处理段落数: ${s.batchedSegments} | 节省API请求数: ${s.savedApiRequests}`,
      `- 队列状态: 当前 ${s.currentQueueDepth} | 峰值 ${s.maxQueueDepth}`,
      ``,
      `#### 🚀 Groq 主通道`,
      `- 发起请求数: ${s.groqRequests}`,
      `- 成功次数: ${s.groqSuccesses}`,
      `- 429 限流次数: ${s.groq429Count}`,
      `- 401/403 鉴权错误: ${s.groqAuthErrorCount}`,
      `- 其他异常: ${s.groqOtherErrors}`,
      ``,
      `#### 🛡️ Gemini 备用通道`,
      `- 触发降级次数: ${s.geminiFallbackAttempts}`,
      `- 备用成功次数: ${s.geminiSuccesses}`,
      `- 备用失败次数: ${s.geminiFailures}`,
      ``,
      `#### ⚠️ 最终未完成`,
      `- 双通道全失败: ${s.allProviderFailures}`,
    ].join('\n');
  }

  public subscribe(listener: StatsListener): () => void {
    this.listeners.add(listener);
    // Emit initial
    listener(this.getStats());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const current = this.getStats();
    for (const listener of this.listeners) {
      try {
        listener(current);
      } catch (e) {
        console.error('[TranslationStats] Listener error:', e);
      }
    }
  }
}

export const translationStatsTracker = new TranslationStatsTracker();
