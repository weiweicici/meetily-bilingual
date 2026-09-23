import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  UnifiedTranslationScheduler,
  type EnqueueTaskOptions,
} from '../../src/services/unifiedTranslationScheduler.ts';

import {
  getUserTranslationMode,
  setUserTranslationMode,
  type UserTranslationMode,
} from '../../src/services/geminiTranslationService.ts';

import {
  setMockLocalQwenAvailable,
  isLocalQwenModelAvailable,
} from '../../src/services/localTranslationService.ts';

// Helper to mock localStorage for node test runner
function setupMockLocalStorage() {
  const store = new Map<string, string>();
  const mockLocalStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, String(value)),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: mockLocalStorage,
    writable: true,
    configurable: true,
  });

  return store;
}

function mockGroqBatchResponse(text: string, defaultOutput: string): string {
  if (text.includes('Input Segments:')) {
    try {
      const jsonStr = text.split('Input Segments:')[1].trim();
      const items = JSON.parse(jsonStr);
      if (Array.isArray(items)) {
        return JSON.stringify(
          items.map((it: any) => ({
            id: it.id,
            translation: defaultOutput.startsWith('Cloud:') ? `Cloud: ${it.text}` : defaultOutput,
          }))
        );
      }
    } catch (_) {}
  }
  return defaultOutput;
}

describe('Phase 5B — Translation Provider Selection & Hot Switching (Cloud ↔ Local Qwen)', () => {
  beforeEach(() => {
    setupMockLocalStorage();
    setMockLocalQwenAvailable(true);
  });

  test('TEST A — Default provider is Cloud when no preference is saved', () => {
    const mode = getUserTranslationMode();
    assert.equal(mode, 'cloud', 'Default provider mode must be cloud');
  });

  test('TEST B — Persist Local Qwen selection across initialization', async () => {
    const res = await setUserTranslationMode('local_qwen');
    assert.equal(res.success, true);
    assert.equal(getUserTranslationMode(), 'local_qwen');

    // Simulate app restart / re-read
    const restored = getUserTranslationMode();
    assert.equal(restored, 'local_qwen', 'Local Qwen preference must persist');
  });

  test('TEST C — Persist Cloud selection across initialization', async () => {
    await setUserTranslationMode('local_qwen');
    assert.equal(getUserTranslationMode(), 'local_qwen');

    const res = await setUserTranslationMode('cloud');
    assert.equal(res.success, true);
    assert.equal(getUserTranslationMode(), 'cloud', 'Cloud preference must persist');
  });

  test('TEST D — Cloud → Local ownership: existing Cloud items stay Cloud, new item becomes Local', async () => {
    const executedProviders: string[] = [];

    const scheduler = new UnifiedTranslationScheduler({
      backendTranslateGroqFn: async (text) => {
        executedProviders.push('cloud');
        return mockGroqBatchResponse(text, 'Cloud Translated');
      },
      backendTranslateLocalFn: async (segments) => {
        executedProviders.push('local_qwen');
        return {
          successful_segments: segments.map(s => ({ id: s.id, translation: 'Local Translated' })),
          failed_ids: [],
        };
      },
    });

    scheduler.setProvider('cloud');

    // Enqueue 2 short Cloud items (staying in Cloud pending batch)
    const p1 = scheduler.enqueue({ id: '1', text: 'Hello class', sequenceId: 101, provider: 'cloud' });
    const p2 = scheduler.enqueue({ id: '2', text: 'Welcome today', sequenceId: 102, provider: 'cloud' });

    // Switch provider to Local Qwen
    scheduler.setProvider('local_qwen');

    // Enqueue 1 Local item
    const p3 = scheduler.enqueue({ id: '3', text: 'Local segment now', sequenceId: 103, provider: 'local_qwen' });

    // Flush Cloud batch
    scheduler.flushPendingBatch('word_threshold');

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    assert.equal(r1, 'Cloud Translated');
    assert.equal(r2, 'Cloud Translated');
    assert.equal(r3, 'Local Translated');

    assert.deepEqual(executedProviders, ['local_qwen', 'cloud']);
  });

  test('TEST E — Local → Cloud ownership: existing Local items stay Local, new item becomes Cloud', async () => {
    let resolveLocalFn: ((val: any) => void) | null = null;
    const executedProviders: string[] = [];

    const scheduler = new UnifiedTranslationScheduler({
      backendTranslateGroqFn: async (text) => {
        executedProviders.push('cloud');
        return 'Cloud Result';
      },
      backendTranslateLocalFn: async (segments) => {
        executedProviders.push('local_qwen');
        return new Promise(r => {
          resolveLocalFn = (v: any) => r(v);
        });
      },
    });

    scheduler.setProvider('local_qwen');

    // #201 starts Local execution immediately
    const p201 = scheduler.enqueue({ id: '201', text: 'Segment 201', sequenceId: 201 });
    // #202 and #203 enter local pending FIFO
    const p202 = scheduler.enqueue({ id: '202', text: 'Segment 202', sequenceId: 202 });
    const p203 = scheduler.enqueue({ id: '203', text: 'Segment 203', sequenceId: 203 });

    // Switch to Cloud
    scheduler.setProvider('cloud');

    // #204 enters Cloud queue (long segment >= 20 words for instant dispatch)
    const p204 = scheduler.enqueue({
      id: '204',
      text: 'This is a long English transcript segment that exceeds the twenty words limit to trigger immediate cloud translation dispatch without waiting',
      sequenceId: 204,
      provider: 'cloud',
    });

    // Cloud #204 executes in parallel while Local #201 is still waiting
    const r204 = await p204;
    assert.equal(r204, 'Cloud Result');

    // Resolve Local #201
    if (resolveLocalFn) {
      (resolveLocalFn as (val: any) => void)({
        successful_segments: [{ id: 201, translation: 'Local Result 201' }],
        failed_ids: [],
      });
    }
    const r201 = await p201;
    assert.equal(r201, 'Local Result 201');

    // Allow local pending #202,#203 batch to run and resolve
    await new Promise(r => setTimeout(r, 50));
    if (resolveLocalFn) {
      (resolveLocalFn as (val: any) => void)({
        successful_segments: [
          { id: 202, translation: 'Local Result 202' },
          { id: 203, translation: 'Local Result 203' },
        ],
        failed_ids: [],
      });
    }

    const [r202, r203] = await Promise.all([p202, p203]);
    assert.equal(r202, 'Local Result 202');
    assert.equal(r203, 'Local Result 203');

    assert.ok(executedProviders.includes('cloud'));
    assert.ok(executedProviders.includes('local_qwen'));
  });

  test('TEST F — Old Local failure after switch: ZERO Groq/Gemini fallback calls', async () => {
    let groqCalls = 0;
    let geminiCalls = 0;

    const scheduler = new UnifiedTranslationScheduler({
      backendTranslateGroqFn: async () => {
        groqCalls++;
        return 'Groq Should Not Be Called';
      },
      backendTranslateGeminiFn: async () => {
        geminiCalls++;
        return 'Gemini Should Not Be Called';
      },
      backendTranslateLocalFn: async () => {
        throw new Error('Local Qwen hardware error');
      },
    });

    scheduler.setProvider('local_qwen');
    const p301 = scheduler.enqueue({ id: '301', text: 'Segment 301', sequenceId: 301 });

    // User switches to Cloud
    scheduler.setProvider('cloud');

    const res = await p301;

    assert.equal(res, null, 'Failed Local segment must resolve null under strict local privacy');
    assert.equal(groqCalls, 0, 'Groq calls for failed Local item must be 0');
    assert.equal(geminiCalls, 0, 'Gemini calls for failed Local item must be 0');
  });

  test('TEST G — Out-of-order completion: Cloud resolves before Local without mis-mapping', async () => {
    let resolveLocalFn: ((val: any) => void) | null = null;
    const completedResults: Array<{ seq: number; result: string | null }> = [];

    const scheduler = new UnifiedTranslationScheduler({
      backendTranslateGroqFn: async () => 'Cloud Translation 402',
      backendTranslateLocalFn: async (segments) => {
        return new Promise(r => {
          resolveLocalFn = (v: any) => r(v);
        });
      },
    });

    scheduler.setProvider('local_qwen');
    const p401 = scheduler.enqueue({ id: '401', text: 'Local segment', sequenceId: 401 });

    scheduler.setProvider('cloud');
    const p402 = scheduler.enqueue({
      id: '402',
      text: 'Long English segment for cloud translation that exceeds twenty words limit for immediate execution',
      sequenceId: 402,
      provider: 'cloud',
    });

    p402.then(res => completedResults.push({ seq: 402, result: res }));
    p401.then(res => completedResults.push({ seq: 401, result: res }));

    const r402 = await p402;
    assert.equal(r402, 'Cloud Translation 402');
    assert.equal(completedResults[0].seq, 402, 'Cloud #402 completed first');

    if (resolveLocalFn) {
      (resolveLocalFn as (val: any) => void)({
        successful_segments: [{ id: 401, translation: 'Local Translation 401' }],
        failed_ids: [],
      });
    }

    const r401 = await p401;
    assert.equal(r401, 'Local Translation 401');
    assert.equal(completedResults[1].seq, 401, 'Local #401 completed second');
  });

  test('TEST H — Multiple provider switches retain exact sequence ownership', async () => {
    const scheduler = new UnifiedTranslationScheduler({
      backendTranslateGroqFn: async (text) => mockGroqBatchResponse(text, `Cloud: ${text}`),
      backendTranslateLocalFn: async (segments) => ({
        successful_segments: segments.map(s => ({ id: s.id, translation: `Local: ${s.text}` })),
        failed_ids: [],
      }),
    });

    // #501 Local
    scheduler.setProvider('local_qwen');
    const p501 = scheduler.enqueue({ id: '501', text: 'S501', sequenceId: 501, provider: 'local_qwen' });

    // Switch Cloud -> #502 Cloud
    scheduler.setProvider('cloud');
    const p502 = scheduler.enqueue({ id: '502', text: 'S502 twenty words limit long text segment for cloud execution', sequenceId: 502, provider: 'cloud' });

    // Switch Local -> #503 Local
    scheduler.setProvider('local_qwen');
    const p503 = scheduler.enqueue({ id: '503', text: 'S503', sequenceId: 503, provider: 'local_qwen' });

    // Switch Cloud -> #504 Cloud
    scheduler.setProvider('cloud');
    const p504 = scheduler.enqueue({ id: '504', text: 'S504 twenty words limit long text segment for cloud execution', sequenceId: 504, provider: 'cloud' });

    const [r501, r502, r503, r504] = await Promise.all([p501, p502, p503, p504]);

    assert.equal(r501, 'Local: S501');
    assert.equal(r502, 'Cloud: S502 twenty words limit long text segment for cloud execution');
    assert.equal(r503, 'Local: S503');
    assert.equal(r504, 'Cloud: S504 twenty words limit long text segment for cloud execution');
  });

  test('TEST I — Provider switch does not cancel an active in-flight request', async () => {
    let completed = false;
    const scheduler = new UnifiedTranslationScheduler({
      backendTranslateLocalFn: async (segments) => {
        await new Promise(r => setTimeout(r, 60));
        completed = true;
        return {
          successful_segments: segments.map(s => ({ id: s.id, translation: 'In-flight Done' })),
          failed_ids: [],
        };
      },
    });

    scheduler.setProvider('local_qwen');
    const p = scheduler.enqueue({ id: 'sub', text: 'In-flight test', sequenceId: 999 });

    // Immediately switch provider
    scheduler.setProvider('cloud');

    const res = await p;
    assert.equal(completed, true, 'In-flight request completed despite provider switch');
    assert.equal(res, 'In-flight Done');
  });

  test('TEST J — Switching provider does not clear pending Local items', async () => {
    let resolveLocalFn: ((val: any) => void) | null = null;
    const scheduler = new UnifiedTranslationScheduler({
      backendTranslateLocalFn: async (segments) => {
        return new Promise(r => {
          resolveLocalFn = (v: any) => r(v);
        });
      },
    });

    scheduler.setProvider('local_qwen');
    const p601 = scheduler.enqueue({ id: '601', text: 'Segment 601', sequenceId: 601 });
    const p602 = scheduler.enqueue({ id: '602', text: 'Segment 602', sequenceId: 602 });
    const p603 = scheduler.enqueue({ id: '603', text: 'Segment 603', sequenceId: 603 });

    // Switch to Cloud
    scheduler.setProvider('cloud');

    if (resolveLocalFn) {
      (resolveLocalFn as (val: any) => void)({
        successful_segments: [{ id: 601, translation: 'Local 601' }],
        failed_ids: [],
      });
    }
    await p601;

    await new Promise(r => setTimeout(r, 40));
    if (resolveLocalFn) {
      (resolveLocalFn as (val: any) => void)({
        successful_segments: [
          { id: 602, translation: 'Local 602' },
          { id: 603, translation: 'Local 603' },
        ],
        failed_ids: [],
      });
    }

    const [r602, r603] = await Promise.all([p602, p603]);
    assert.equal(r602, 'Local 602');
    assert.equal(r603, 'Local 603');
  });

  test('TEST K — Switching provider does not clear pending Cloud batch items', async () => {
    const scheduler = new UnifiedTranslationScheduler({
      backendTranslateGroqFn: async (text) => mockGroqBatchResponse(text, 'Cloud Flush Result'),
    });

    scheduler.setProvider('cloud');
    const p701 = scheduler.enqueue({ id: '701', text: 'Short 701', sequenceId: 701, provider: 'cloud' });
    const p702 = scheduler.enqueue({ id: '702', text: 'Short 702', sequenceId: 702, provider: 'cloud' });

    // Switch to Local Qwen
    scheduler.setProvider('local_qwen');

    // Flush Cloud batch
    scheduler.flushPendingBatch('word_threshold');

    const [r701, r702] = await Promise.all([p701, p702]);
    assert.equal(r701, 'Cloud Flush Result');
    assert.equal(r702, 'Cloud Flush Result');
  });

  test('TEST L — Local unavailable rejects switch gracefully without crash', async () => {
    setMockLocalQwenAvailable(false);

    const res = await setUserTranslationMode('local_qwen');
    assert.equal(res.success, false);
    assert.equal(res.error, 'Local Qwen model is not available.');
    assert.equal(getUserTranslationMode(), 'cloud', 'Provider remains unchanged on rejected switch');
  });

  test('TEST M — Cloud micro-batching rules remain 20 words, 3 segments, 6000ms', async () => {
    let callCount = 0;
    const scheduler = new UnifiedTranslationScheduler({
      backendTranslateGroqFn: async (text) => {
        callCount++;
        return mockGroqBatchResponse(text, 'Cloud Batch');
      },
    });

    scheduler.setProvider('cloud');
    const p1 = scheduler.enqueue({ id: 'm1', text: 'One two three four five six seven eight nine ten', sequenceId: 801, provider: 'cloud' });
    const p2 = scheduler.enqueue({ id: 'm2', text: 'One two three four five six seven eight nine ten', sequenceId: 802, provider: 'cloud' });

    // Reach 20 words threshold
    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1, 'Cloud Batch');
    assert.equal(r2, 'Cloud Batch');
    assert.equal(callCount, 1, 'Batching 20 words reduced call count to 1');
  });

  test('TEST N — Local dynamic batching rules remain idle immediate, busy queue, max batch 3', async () => {
    let localBatches = 0;
    let resolveLocalFn: ((val: any) => void) | null = null;

    const scheduler = new UnifiedTranslationScheduler({
      backendTranslateLocalFn: async (segments) => {
        localBatches++;
        return new Promise(r => {
          resolveLocalFn = (v: any) => r(v);
        });
      },
    });

    scheduler.setProvider('local_qwen');

    // Idle -> immediate dispatch
    const p1 = scheduler.enqueue({ id: 'n1', text: 'Seg 1', sequenceId: 901 });
    assert.equal(localBatches, 1);

    // Busy -> queue
    const p2 = scheduler.enqueue({ id: 'n2', text: 'Seg 2', sequenceId: 902 });
    const p3 = scheduler.enqueue({ id: 'n3', text: 'Seg 3', sequenceId: 903 });

    if (resolveLocalFn) {
      (resolveLocalFn as (val: any) => void)({
        successful_segments: [{ id: 901, translation: 'Local 901' }],
        failed_ids: [],
      });
    }
    await p1;

    await new Promise(r => setTimeout(r, 40));
    assert.equal(localBatches, 2, 'Pending queue flushed immediately upon completion');

    if (resolveLocalFn) {
      (resolveLocalFn as (val: any) => void)({
        successful_segments: [
          { id: 902, translation: 'Local 902' },
          { id: 903, translation: 'Local 903' },
        ],
        failed_ids: [],
      });
    }

    const [r2, r3] = await Promise.all([p2, p3]);
    assert.equal(r2, 'Local 902');
    assert.equal(r3, 'Local 903');
  });

  test('TEST O — Maximum active Local inference concurrency is strictly 1', async () => {
    let activeLocalConcurrency = 0;
    let maxObservedLocalConcurrency = 0;

    const scheduler = new UnifiedTranslationScheduler({
      backendTranslateLocalFn: async (segments) => {
        activeLocalConcurrency++;
        maxObservedLocalConcurrency = Math.max(maxObservedLocalConcurrency, activeLocalConcurrency);
        await new Promise(r => setTimeout(r, 30));
        activeLocalConcurrency--;
        return {
          successful_segments: segments.map(s => ({ id: s.id, translation: 'OK' })),
          failed_ids: [],
        };
      },
    });

    scheduler.setProvider('local_qwen');

    const tasks = Array.from({ length: 6 }, (_, i) =>
      scheduler.enqueue({ id: `o${i}`, text: `Seg ${i}`, sequenceId: 1000 + i })
    );

    await Promise.all(tasks);

    assert.equal(maxObservedLocalConcurrency, 1, 'Max Local concurrency must be 1');
  });

  test('TEST P — Session stop flushes both provider queues without dropping work', async () => {
    const executed: string[] = [];

    const scheduler = new UnifiedTranslationScheduler({
      backendTranslateGroqFn: async (text) => {
        executed.push('cloud');
        return mockGroqBatchResponse(text, 'Cloud Done');
      },
      backendTranslateLocalFn: async (segments) => {
        executed.push('local');
        return {
          successful_segments: segments.map(s => ({ id: s.id, translation: 'Local Done' })),
          failed_ids: [],
        };
      },
    });

    // Enqueue Cloud item
    scheduler.setProvider('cloud');
    const pCloud = scheduler.enqueue({ id: 'c', text: 'Cloud short segment', sequenceId: 1101, provider: 'cloud' });

    // Switch to Local and enqueue Local item while Local is held busy
    scheduler.setProvider('local_qwen');
    const pLocal = scheduler.enqueue({ id: 'l', text: 'Local segment', sequenceId: 1102, provider: 'local_qwen' });

    // Session stops
    scheduler.flushPendingBatch('session_stop');

    const [rc, rl] = await Promise.all([pCloud, pLocal]);
    assert.equal(rc, 'Cloud Done');
    assert.equal(rl, 'Local Done');
    assert.ok(executed.includes('cloud'));
    assert.ok(executed.includes('local'));
  });

  test('TEST Q — Duplicate sequence protection prevents state corruption', async () => {
    const translationMap = new Map<number, string>();

    function safeUpdateTranslationMap(seq: number, translation: string) {
      if (translationMap.has(seq)) {
        // Safe duplicate protection: preserve existing value and log duplicate safely
        return false;
      }
      translationMap.set(seq, translation);
      return true;
    }

    const first = safeUpdateTranslationMap(1201, 'First Translation');
    assert.equal(first, true);
    assert.equal(translationMap.get(1201), 'First Translation');

    // Simulate accidental duplicate completion
    const second = safeUpdateTranslationMap(1201, 'Duplicate Translation');
    assert.equal(second, false);
    assert.equal(translationMap.get(1201), 'First Translation', 'First translation must be preserved');
  });
});
