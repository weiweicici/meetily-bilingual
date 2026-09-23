import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  UnifiedTranslationScheduler,
  countEnglishWords,
  SHORT_SEGMENT_THRESHOLD,
  MAX_BATCH_SEGMENTS,
} from '../../src/services/unifiedTranslationScheduler.ts';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, String(v)),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
  };
}
(globalThis as any).window = globalThis;

describe('Phase 5A: Local Qwen Dynamic / Opportunistic Batching', () => {
  let scheduler: UnifiedTranslationScheduler;

  beforeEach(() => {
    scheduler = new UnifiedTranslationScheduler({
      maxConcurrency: 1,
      minIntervalMs: 0,
      provider: 'local_qwen',
    });
  });

  // TEST A: Idle single segment starts immediately
  test('TEST A — Idle single segment starts immediately without 6000ms wait', async () => {
    let callTime = 0;
    const startTime = Date.now();

    const mockBackend = async (segments: any[]) => {
      callTime = Date.now();
      return {
        successful_segments: segments.map((s: any) => ({
          id: s.id,
          translation: `【本地】${s.text}`,
        })),
        failed_ids: [],
      };
    };

    scheduler.setBackendTranslateLocalFn(mockBackend);

    const promise = scheduler.enqueue({
      id: 'seg-101',
      text: 'Hello world classroom segment',
      sequenceId: 101,
    });

    const result = await promise;
    assert.equal(result, '【本地】Hello world classroom segment');
    assert.ok(callTime - startTime < 100, 'Must execute immediately without 6000ms wait');
  });

  // TEST B: Short segment also starts immediately
  test('TEST B — Short segment (5-10 words) starts immediately under local_qwen', async () => {
    let callCount = 0;
    const mockBackend = async (segments: any[]) => {
      callCount++;
      return {
        successful_segments: segments.map((s: any) => ({
          id: s.id,
          translation: `【本地】${s.text}`,
        })),
        failed_ids: [],
      };
    };

    scheduler.setBackendTranslateLocalFn(mockBackend);

    const shortText = 'Short five word segment test'; // 5 words < 20 words
    assert.equal(countEnglishWords(shortText), 5);

    const result = await scheduler.enqueue({
      id: 'seg-101',
      text: shortText,
      sequenceId: 101,
    });

    assert.equal(result, '【本地】Short five word segment test');
    assert.equal(callCount, 1, 'Must call backend immediately for short segment when idle');
  });

  // TEST C: Busy model accumulates
  test('TEST C — Busy model accumulates newly arriving segments into pending queue', async () => {
    let resolveFirstInference: any;
    const firstInferencePromise = new Promise((resolve) => {
      resolveFirstInference = resolve;
    });

    let backendCallCount = 0;
    const mockBackend = async (segments: any[]) => {
      backendCallCount++;
      if (segments[0].id === 101) {
        await firstInferencePromise;
        return {
          successful_segments: [{ id: 101, translation: '【本地】#101' }],
          failed_ids: [],
        };
      }
      return {
        successful_segments: segments.map((s: any) => ({
          id: s.id,
          translation: `【本地】#${s.id}`,
        })),
        failed_ids: [],
      };
    };

    scheduler.setBackendTranslateLocalFn(mockBackend);

    // 1. Send #101 while model is idle -> starts immediately
    const p101 = scheduler.enqueue({ id: 'seg-101', text: 'First segment', sequenceId: 101 });

    // Wait a tick for scheduler to dispatch #101
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(backendCallCount, 1);
    assert.equal(scheduler.getActiveCount(), 1);

    // 2. While #101 is busy, send #102 and #103
    const p102 = scheduler.enqueue({ id: 'seg-102', text: 'Second segment', sequenceId: 102 });
    const p103 = scheduler.enqueue({ id: 'seg-103', text: 'Third segment', sequenceId: 103 });

    // Verify mockBackend was NOT called a second time concurrently
    assert.equal(backendCallCount, 1);
    assert.equal(scheduler.getPendingBatchLength(), 2);

    // Complete #101
    resolveFirstInference();
    const res101 = await p101;
    assert.equal(res101, '【本地】#101');

    // Wait for pending batch to resolve
    const [res102, res103] = await Promise.all([p102, p103]);
    assert.equal(res102, '【本地】#102');
    assert.equal(res103, '【本地】#103');
    assert.equal(backendCallCount, 2);
  });

  // TEST D: Pending flushes immediately after completion
  test('TEST D — Pending queue flushes immediately after active completion without wait timer', async () => {
    let finishInference1: any;
    const calls: any[][] = [];
    const mockBackend = async (segments: any[]) => {
      calls.push(segments);
      if (segments[0].id === 101) {
        await new Promise((r) => { finishInference1 = r; });
      }
      return {
        successful_segments: segments.map((s: any) => ({
          id: s.id,
          translation: `【本地】#${s.id}`,
        })),
        failed_ids: [],
      };
    };

    scheduler.setBackendTranslateLocalFn(mockBackend);

    const p101 = scheduler.enqueue({ id: '101', text: 'Seg 101', sequenceId: 101 });
    await new Promise((r) => setTimeout(r, 10));

    const p102 = scheduler.enqueue({ id: '102', text: 'Seg 102', sequenceId: 102 });
    const p103 = scheduler.enqueue({ id: '103', text: 'Seg 103', sequenceId: 103 });

    assert.equal(calls.length, 1);

    // Complete #101
    finishInference1();

    await Promise.all([p101, p102, p103]);

    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], [
      { id: 102, text: 'Seg 102' },
      { id: 103, text: 'Seg 103' },
    ]);
  });

  // TEST E: Maximum 3 per Local batch
  test('TEST E — Maximum 3 segments per Local batch when draining pending queue', async () => {
    let finishInference1: any;
    let finishInference2: any;
    const executedBatches: number[][] = [];

    const mockBackend = async (segments: any[]) => {
      executedBatches.push(segments.map((s: any) => s.id));
      if (segments[0].id === 101) {
        await new Promise((r) => { finishInference1 = r; });
      } else if (segments[0].id === 102) {
        await new Promise((r) => { finishInference2 = r; });
      }
      return {
        successful_segments: segments.map((s: any) => ({
          id: s.id,
          translation: `【本地】#${s.id}`,
        })),
        failed_ids: [],
      };
    };

    scheduler.setBackendTranslateLocalFn(mockBackend);

    const p101 = scheduler.enqueue({ id: '101', text: 'Seg 101', sequenceId: 101 });
    await new Promise((r) => setTimeout(r, 10));

    // While 101 runs, enqueue 102..106 (5 segments)
    const p102 = scheduler.enqueue({ id: '102', text: 'Seg 102', sequenceId: 102 });
    const p103 = scheduler.enqueue({ id: '103', text: 'Seg 103', sequenceId: 103 });
    const p104 = scheduler.enqueue({ id: '104', text: 'Seg 104', sequenceId: 104 });
    const p105 = scheduler.enqueue({ id: '105', text: 'Seg 105', sequenceId: 105 });
    const p106 = scheduler.enqueue({ id: '106', text: 'Seg 106', sequenceId: 106 });

    // Finish #101
    finishInference1();
    await p101;
    await new Promise((r) => setTimeout(r, 10));

    // Next batch should take max 3 segments: [102, 103, 104]
    assert.deepEqual(executedBatches[1], [102, 103, 104]);

    // Finish second batch
    finishInference2();

    const results = await Promise.all([p102, p103, p104, p105, p106]);
    assert.deepEqual(results, [
      '【本地】#102',
      '【本地】#103',
      '【本地】#104',
      '【本地】#105',
      '【本地】#106',
    ]);

    assert.deepEqual(executedBatches[2], [105, 106]);
    assert.equal(executedBatches.length, 3);
  });

  // TEST F: FIFO preserved
  test('TEST F — FIFO order preserved across all batch dispatches', async () => {
    const executedBatches: number[][] = [];
    const mockBackend = async (segments: any[]) => {
      executedBatches.push(segments.map((s: any) => s.id));
      return {
        successful_segments: segments.map((s: any) => ({
          id: s.id,
          translation: `【本地】#${s.id}`,
        })),
        failed_ids: [],
      };
    };

    scheduler.setBackendTranslateLocalFn(mockBackend);

    const promises = [101, 102, 103, 104, 105].map((id) =>
      scheduler.enqueue({ id: String(id), text: `Text ${id}`, sequenceId: id })
    );

    await Promise.all(promises);

    assert.deepEqual(executedBatches, [
      [101],
      [102, 103, 104],
      [105],
    ]);
  });

  // TEST G: Strict IDs
  test('TEST G — Strict sequence ID mapping with zero positional remapping', async () => {
    const mockBackend = async (segments: any[]) => ({
      successful_segments: [
        { id: 201, translation: '【本地】#201' },
        { id: 203, translation: '【本地】#203' },
        // 202 is missing!
      ],
      failed_ids: [202],
    });

    let finishInference1: any;
    scheduler.setBackendTranslateLocalFn(async (segments) => {
      if (segments[0].id === 100) {
        await new Promise((r) => { finishInference1 = r; });
        return { successful_segments: [{ id: 100, translation: 'Hold' }], failed_ids: [] };
      }
      return mockBackend(segments);
    });

    const pHold = scheduler.enqueue({ id: 'hold', text: 'Hold', sequenceId: 100 });
    await new Promise((r) => setTimeout(r, 10));

    const p201 = scheduler.enqueue({ id: '201', text: 'Text 201', sequenceId: 201 });
    const p202 = scheduler.enqueue({ id: '202', text: 'Text 202', sequenceId: 202 });
    const p203 = scheduler.enqueue({ id: '203', text: 'Text 203', sequenceId: 203 });

    finishInference1();

    const results = await Promise.all([pHold, p201, p202, p203]);

    assert.equal(results[1], '【本地】#201');
    assert.equal(results[2], null); // Missing sequence ID resolves null, no shift!
    assert.equal(results[3], '【本地】#203');
  });

  // TEST H: Local failure stays Local
  test('TEST H — Local failure resolves null with zero fallback calls to Groq or Gemini', async () => {
    let groqCalls = 0;
    let geminiCalls = 0;

    const mockLocalBackend = async () => {
      throw new Error('Vulkan helper crash');
    };
    const mockGroqBackend = async () => {
      groqCalls++;
      return 'Groq should not be called';
    };
    const mockGeminiBackend = async () => {
      geminiCalls++;
      return 'Gemini should not be called';
    };

    scheduler.setBackendTranslateLocalFn(mockLocalBackend);
    scheduler.setBackendTranslateGroqFn(mockGroqBackend);
    scheduler.setBackendTranslateGeminiFn(mockGeminiBackend);

    const result = await scheduler.enqueue({
      id: 'seg-101',
      text: 'Private local data segment',
      sequenceId: 101,
    });

    assert.equal(result, null);
    assert.equal(groqCalls, 0);
    assert.equal(geminiCalls, 0);
  });

  // TEST I: Cloud 6000ms batching unchanged
  test('TEST I — Cloud (Groq) batching 6000ms behavior remains unchanged when provider is groq', async () => {
    const cloudScheduler = new UnifiedTranslationScheduler({
      maxConcurrency: 1,
      provider: 'groq',
    });

    let groqCalls = 0;
    const mockGroq = async () => {
      groqCalls++;
      return '【Groq】Short segment';
    };
    cloudScheduler.setBackendTranslateGroqFn(mockGroq);

    const start = Date.now();
    const promise = cloudScheduler.enqueue({
      id: 'seg-101',
      text: 'Short segment', // 2 words < 20 words
      sequenceId: 101,
    });

    const res = await promise;
    const elapsed = Date.now() - start;

    assert.equal(res, '【Groq】Short segment');
    assert.equal(groqCalls, 1);
    assert.ok(elapsed >= 5900, `Cloud short segment must wait ~6000ms timer (elapsed: ${elapsed}ms)`);
  });

  // TEST J: Existing classroom TEST R unchanged
  test('TEST J — Classroom TEST R (20-word threshold flush) remains unchanged for Groq', async () => {
    const cloudScheduler = new UnifiedTranslationScheduler({
      maxConcurrency: 1,
      provider: 'groq',
    });

    let groqCalls = 0;
    const mockGroq = async () => {
      groqCalls++;
      return JSON.stringify([
        { id: 1, translation: '【Groq】Seg 1' },
        { id: 2, translation: '【Groq】Seg 2' },
      ]);
    };
    cloudScheduler.setBackendTranslateGroqFn(mockGroq);

    const p1 = cloudScheduler.enqueue({
      id: '1',
      text: 'Short 7 word segment text here right now', // 7 words
      sequenceId: 1,
    });

    assert.equal(groqCalls, 0);

    const p2 = cloudScheduler.enqueue({
      id: '2',
      text: 'This is a sixteen word segment that combines with the first segment to reach threshold total', // 16 words (total = 23 words >= 20)
      sequenceId: 2,
    });

    const [r1, r2] = await Promise.all([p1, p2]);
    assert.equal(r1, '【Groq】Seg 1');
    assert.equal(r2, '【Groq】Seg 2');
    assert.equal(groqCalls, 1); // Flushed immediately on reaching 23 words
  });

  // TEST K: No concurrent Local inference
  test('TEST K — Maximum concurrent active Local backend calls = 1', async () => {
    let activeCalls = 0;
    let maxActiveCalls = 0;

    const mockBackend = async (segments: any[]) => {
      activeCalls++;
      if (activeCalls > maxActiveCalls) maxActiveCalls = activeCalls;
      await new Promise((r) => setTimeout(r, 20));
      activeCalls--;
      return {
        successful_segments: segments.map((s: any) => ({ id: s.id, translation: 'OK' })),
        failed_ids: [],
      };
    };

    scheduler.setBackendTranslateLocalFn(mockBackend);

    const promises = Array.from({ length: 10 }, (_, i) =>
      scheduler.enqueue({ id: String(i), text: `Segment ${i}`, sequenceId: i + 1 })
    );

    await Promise.all(promises);

    assert.equal(maxActiveCalls, 1); // Strict serialization
  });

  // TEST L: Local queue drains automatically
  test('TEST L — Scheduler automatically drains pending Local queue until empty', async () => {
    const mockBackend = async (segments: any[]) => ({
      successful_segments: segments.map((s: any) => ({
        id: s.id,
        translation: `Done #${s.id}`,
      })),
      failed_ids: [],
    });

    scheduler.setBackendTranslateLocalFn(mockBackend);

    const promises = Array.from({ length: 8 }, (_, i) =>
      scheduler.enqueue({ id: String(i), text: `Segment ${i}`, sequenceId: i + 1 })
    );

    const results = await Promise.all(promises);

    assert.equal(results.length, 8);
    assert.ok(results.every((r) => typeof r === 'string' && r.startsWith('Done #')));
    assert.equal(scheduler.getQueueLength(), 0);
    assert.equal(scheduler.getPendingBatchLength(), 0);
  });

  // TEST M: No Local 6000ms timer dependency
  test('TEST M — Local inference completion triggers next batch immediately without 6000ms wait', async () => {
    let finishInference1: any;
    let callCount = 0;

    const mockBackend = async (segments: any[]) => {
      callCount++;
      if (segments[0].id === 101) {
        await new Promise((r) => { finishInference1 = r; });
      }
      return {
        successful_segments: segments.map((s: any) => ({ id: s.id, translation: `Done #${s.id}` })),
        failed_ids: [],
      };
    };

    scheduler.setBackendTranslateLocalFn(mockBackend);

    const p101 = scheduler.enqueue({ id: '101', text: 'Seg 101', sequenceId: 101 });
    await new Promise((r) => setTimeout(r, 10));

    const p102 = scheduler.enqueue({ id: '102', text: 'Seg 102', sequenceId: 102 });

    // Wait 200ms while #101 is busy
    await new Promise((r) => setTimeout(r, 200));

    // While busy, callCount must stay 1
    assert.equal(callCount, 1);

    // Finish #101
    finishInference1();

    await Promise.all([p101, p102]);

    assert.equal(callCount, 2);
  });

  // TEST N: Session stop does not silently lose pending Local segments
  test('TEST N — Session stop flushes pending Local segments safely without silent drops', async () => {
    let finishInference1: any;
    const mockBackend = async (segments: any[]) => {
      if (segments[0].id === 101) {
        await new Promise((r) => { finishInference1 = r; });
      }
      return {
        successful_segments: segments.map((s: any) => ({ id: s.id, translation: `Done #${s.id}` })),
        failed_ids: [],
      };
    };

    scheduler.setBackendTranslateLocalFn(mockBackend);

    const p101 = scheduler.enqueue({ id: '101', text: 'Seg 101', sequenceId: 101 });
    await new Promise((r) => setTimeout(r, 10));

    const p102 = scheduler.enqueue({ id: '102', text: 'Seg 102', sequenceId: 102 });
    const p103 = scheduler.enqueue({ id: '103', text: 'Seg 103', sequenceId: 103 });

    assert.equal(scheduler.getPendingBatchLength(), 2);

    // Trigger session stop flush
    scheduler.flushPendingBatch('session_stop');

    // Finish #101
    finishInference1();

    const results = await Promise.all([p101, p102, p103]);
    assert.deepEqual(results, ['Done #101', 'Done #102', 'Done #103']);
  });
});
