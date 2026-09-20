import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  UnifiedTranslationScheduler,
  OFFICIAL_CANDIDATE_MODELS,
} from '../../src/services/unifiedTranslationScheduler.ts';

describe('UnifiedTranslationScheduler (Phase 2 Acceptance Tests)', () => {
  it('enforces maxConcurrency = 1 and processes burst requests serially', async () => {
    let currentConcurrent = 0;
    let maxObservedConcurrent = 0;

    const mockFetch = async () => {
      currentConcurrent++;
      if (currentConcurrent > maxObservedConcurrent) {
        maxObservedConcurrent = currentConcurrent;
      }
      await new Promise(r => setTimeout(r, 20));
      currentConcurrent--;

      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '测试译文' }] } }],
        }),
      } as unknown as Response;
    };

    const scheduler = new UnifiedTranslationScheduler({
      maxConcurrency: 1,
      minIntervalMs: 5,
      fetchFn: mockFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    });

    // Enqueue 5 requests simultaneously
    const promises = [1, 2, 3, 4, 5].map(i =>
      scheduler.enqueue({
        id: `task-${i}`,
        text: `Segment ${i}`,
        apiKey: 'test-key',
      })
    );

    const results = await Promise.all(promises);
    assert.equal(maxObservedConcurrent, 1, 'Max concurrent requests must never exceed 1');
    assert.equal(results.length, 5);
    assert.ok(results.every(r => r === '测试译文'));
  });

  it('404 model not found disables model for session and falls back to next model', async () => {
    const modelsTried: string[] = [];

    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      const match = urlStr.match(/models\/([^:]+):generateContent/);
      const model = match ? match[1] : 'unknown';
      modelsTried.push(model);

      if (model === OFFICIAL_CANDIDATE_MODELS[0]) {
        // First model returns 404 Not Found
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { message: 'models/not-found' } }),
        } as unknown as Response;
      }

      // Second model succeeds
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '模型2成功译文' }] } }],
        }),
      } as unknown as Response;
    };

    const scheduler = new UnifiedTranslationScheduler({
      maxConcurrency: 1,
      minIntervalMs: 0,
      fetchFn: mockFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    });

    // First request: tries model[0] (404), then model[1] (200)
    const res1 = await scheduler.enqueue({
      id: 'req-1',
      text: 'First request',
      apiKey: 'test-key',
    });

    assert.equal(res1, '模型2成功译文');
    assert.ok(scheduler.getDisabledModels().includes(OFFICIAL_CANDIDATE_MODELS[0]));

    // Second request: model[0] is cached as disabled, so it should NOT be tried again!
    modelsTried.length = 0;
    const res2 = await scheduler.enqueue({
      id: 'req-2',
      text: 'Second request',
      apiKey: 'test-key',
    });

    assert.equal(res2, '模型2成功译文');
    assert.ok(!modelsTried.includes(OFFICIAL_CANDIDATE_MODELS[0]), 'Disabled 404 model must not be retried');
  });

  it('401/403 fails immediately without retrying or looping', async () => {
    let callCount = 0;

    const mockFetch = async () => {
      callCount++;
      return {
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'API key not valid' } }),
      } as unknown as Response;
    };

    const scheduler = new UnifiedTranslationScheduler({
      maxConcurrency: 1,
      minIntervalMs: 0,
      fetchFn: mockFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    });

    const res = await scheduler.enqueue({
      id: 'req-auth-fail',
      text: 'Auth fail test',
      apiKey: 'bad-key',
    });

    assert.equal(res, null);
    assert.equal(callCount, 1, '401 must abort immediately without retrying all candidate models');
  });

  it('429 rate limit triggers cooldown without model rotation', async () => {
    let callCount = 0;
    const modelsTried: string[] = [];

    const mockFetch = async (url: string | URL | Request) => {
      callCount++;
      const urlStr = url.toString();
      const model = OFFICIAL_CANDIDATE_MODELS.find(m => urlStr.includes(m)) || 'unknown';
      modelsTried.push(model);

      if (callCount === 1) {
        // Return 429 with 50ms Retry-After for test speed
        return {
          ok: false,
          status: 429,
          headers: new Headers({ 'Retry-After': '1' }),
          json: async () => ({ error: { message: 'Resource has been exhausted' } }),
        } as unknown as Response;
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '恢复后译文' }] } }],
        }),
      } as unknown as Response;
    };

    const scheduler = new UnifiedTranslationScheduler({
      maxConcurrency: 1,
      minIntervalMs: 0,
      fetchFn: mockFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    });

    const res = await scheduler.enqueue({
      id: 'req-429',
      text: 'Rate limit test',
      apiKey: 'test-key',
    });

    assert.equal(res, '恢复后译文');
    // Verify it did not rotate models on 429
    assert.equal(modelsTried[0], modelsTried[1], '429 must not rotate models to bypass quota');
  });

  it('AbortSignal cancels queued and in-flight tasks cleanly', async () => {
    const controller = new AbortController();

    const mockFetch = async (_url: unknown, init?: RequestInit) => {
      // Wait for signal or timeout
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new Error('Aborted'));
        });
      });
    };

    const scheduler = new UnifiedTranslationScheduler({
      maxConcurrency: 1,
      fetchFn: mockFetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
    });

    const taskPromise = scheduler.enqueue({
      id: 'cancel-task',
      text: 'Cancel test',
      apiKey: 'test-key',
      signal: controller.signal,
    });

    // Abort after 10ms
    setTimeout(() => controller.abort(), 10);

    const result = await taskPromise;
    assert.equal(result, null);
    // Allow a microtask tick for scheduler cleanup
    await new Promise(r => setTimeout(r, 10));
    assert.equal(scheduler.getActiveCount(), 0);
  });
});
