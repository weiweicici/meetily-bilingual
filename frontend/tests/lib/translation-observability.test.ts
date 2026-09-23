import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTranslationError,
  sanitizeLogString,
  type TranslationLogEvent,
} from '../../src/services/translationDiagnosticLogger.ts';
import { translationStatsTracker } from '../../src/services/translationStatsTracker.ts';
import { UnifiedTranslationScheduler } from '../../src/services/unifiedTranslationScheduler.ts';

describe('Translation Observability & Error Classification', () => {
  test('classifyTranslationError accurately categorizes failure modes', () => {
    assert.equal(classifyTranslationError('Groq API error (HTTP 429): Rate limit exceeded'), 'rate_limited_429');
    assert.equal(classifyTranslationError('HTTP 401: Invalid API Key'), 'unauthorized_401');
    assert.equal(classifyTranslationError('HTTP 403: Forbidden access'), 'forbidden_403');
    assert.equal(classifyTranslationError('Groq API key is not configured in secure credential store'), 'credential_missing');
    assert.equal(classifyTranslationError('Keyring read-back failed: OS service error'), 'credential_read_error');
    assert.equal(classifyTranslationError('HTTP 404: models/gemini-2.5-flash not found'), 'model_not_found_404');
    assert.equal(classifyTranslationError('HTTP 400: Bad Request payload'), 'bad_request_400');
    assert.equal(classifyTranslationError('HTTP 503: Service Unavailable'), 'server_5xx');
    assert.equal(classifyTranslationError('Request timed out after 8000ms'), 'timeout');
    assert.equal(classifyTranslationError('fetch failed: ECONNREFUSED'), 'network_error');
    assert.equal(classifyTranslationError('Unexpected token < in JSON at position 0'), 'invalid_json');
    assert.equal(classifyTranslationError('Provider disabled for session'), 'provider_disabled');
    assert.equal(classifyTranslationError(null), 'unknown');
  });

  test('sanitizeLogString completely masks secret tokens and keys', () => {
    const rawWithGroq = 'Error connecting with gsk_abcdef1234567890XYZ_test on endpoint';
    const cleanGroq = sanitizeLogString(rawWithGroq);
    assert.ok(!cleanGroq.includes('gsk_abcdef1234567890XYZ_test'));
    assert.ok(cleanGroq.includes('[REDACTED_GROQ_KEY]'));

    const rawWithGemini = 'Gemini error with AIzaSyAbc123456789XYZ-99 at api';
    const cleanGemini = sanitizeLogString(rawWithGemini);
    assert.ok(!cleanGemini.includes('AIzaSyAbc123456789XYZ-99'));
    assert.ok(cleanGemini.includes('[REDACTED_GEMINI_KEY]'));

    const rawWithBearer = 'Sending Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.test';
    const cleanBearer = sanitizeLogString(rawWithBearer);
    assert.ok(!cleanBearer.includes('eyJhbGciOiJIUzI1NiJ9.test'));
    assert.ok(cleanBearer.includes('Bearer [REDACTED]'));
  });

  test('translationStatsTracker tracks metrics and formats summary without transcript content', () => {
    translationStatsTracker.reset();

    translationStatsTracker.recordEligibleSegment();
    translationStatsTracker.recordEligibleSegment();
    translationStatsTracker.recordEligibleSegment();

    translationStatsTracker.recordGroqRequestStart();
    translationStatsTracker.recordGroqSuccess(250);

    // Second segment: Groq 429 -> Gemini fallback success
    translationStatsTracker.recordGroqRequestStart();
    translationStatsTracker.recordGroq429();
    translationStatsTracker.recordGeminiFallbackAttempt();
    translationStatsTracker.recordGeminiSuccess(650);

    // Third segment: All providers failed
    translationStatsTracker.recordGroqRequestStart();
    translationStatsTracker.recordGroqOtherError();
    translationStatsTracker.recordGeminiFallbackAttempt();
    translationStatsTracker.recordGeminiFailure();
    translationStatsTracker.recordAllProvidersFailed();

    translationStatsTracker.updateQueueDepth(3);

    const stats = translationStatsTracker.getStats();
    assert.equal(stats.totalEligible, 3);
    assert.equal(stats.groqRequests, 3);
    assert.equal(stats.groqSuccesses, 1);
    assert.equal(stats.groq429Count, 1);
    assert.equal(stats.geminiFallbackAttempts, 2);
    assert.equal(stats.geminiSuccesses, 1);
    assert.equal(stats.geminiFailures, 1);
    assert.equal(stats.allProviderFailures, 1);
    assert.equal(stats.maxQueueDepth, 3);
    assert.equal(stats.maxLatencyMs, 650);
    assert.equal(stats.avgLatencyMs, 450); // (250 + 650) / 2
    assert.equal(stats.currentHealth, 'all_failed');

    const summary = translationStatsTracker.formatMarkdownSummary();
    assert.ok(summary.includes('Meetily Bilingual — 会话实时翻译统计报告'));
    assert.ok(summary.includes('总可翻译段落数: 3'));
    assert.ok(summary.includes('Groq 主通道'));
    assert.ok(summary.includes('Gemini 备用通道'));
    assert.ok(!summary.includes('transcript')); // Zero transcript content
    assert.ok(!summary.includes('key'));

    // Reset works cleanly
    translationStatsTracker.reset();
    const afterReset = translationStatsTracker.getStats();
    assert.equal(afterReset.totalEligible, 0);
    assert.equal(afterReset.groqRequests, 0);
    assert.equal(afterReset.currentHealth, 'idle');
  });

  test('UnifiedTranslationScheduler passes sequenceId and updates stats during lifecycle', async () => {
    translationStatsTracker.reset();

    const mockGroq = async (text: string) => {
      await new Promise(r => setTimeout(r, 10));
      return '测试译文';
    };

    const scheduler = new UnifiedTranslationScheduler({
      minIntervalMs: 0,
      backendTranslateGroqFn: mockGroq,
    });

    const res = await scheduler.enqueue({
      id: 'task-obs-1',
      text: 'Observability test segment',
      sequenceId: 101,
    });

    assert.equal(res, '测试译文');
    const stats = translationStatsTracker.getStats();
    assert.equal(stats.groqRequests, 1);
    assert.equal(stats.groqSuccesses, 1);
    assert.equal(stats.currentHealth, 'groq_success');
    assert.ok(stats.avgLatencyMs > 0);
  });
});
