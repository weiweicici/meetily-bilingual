import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    UnifiedTranslationScheduler,
} from "../../src/services/unifiedTranslationScheduler.ts";

if (typeof globalThis.localStorage === "undefined") {
    const store = new Map<string, string>();
    (globalThis as any).localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, String(v)),
        removeItem: (k: string) => store.delete(k),
        clear: () => store.clear(),
    };
}
(globalThis as any).window = globalThis;

describe("Local Qwen 3.5 4B Translation Scheduler Unit Tests (Phase 4)", () => {

    test("TEST 1: Single Local segment dispatches through Local provider", async () => {
        let localCalls = 0;
        let groqCalls = 0;
        let geminiCalls = 0;

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            provider: 'local_qwen',
            backendTranslateLocalFn: async (segments) => {
                localCalls++;
                return {
                    successful_segments: [{ id: segments[0].id, translation: "单句本地翻译" }],
                    failed_ids: [],
                };
            },
            backendTranslateGroqFn: async () => { groqCalls++; return "groq"; },
            backendTranslateGeminiFn: async () => { geminiCalls++; return "gemini"; },
        });

        const res = await scheduler.enqueue({
            id: "s1",
            text: "This is a single long sentence containing twenty words or more for testing immediate local translation dispatch without waiting for timeout flush.",
            sequenceId: 101,
        });

        assert.equal(res, "单句本地翻译");
        assert.equal(localCalls, 1, "Must call local provider exactly 1 time");
        assert.equal(groqCalls, 0, "Must NOT call Groq");
        assert.equal(geminiCalls, 0, "Must NOT call Gemini");
    });

    test("TEST 2: Two-segment micro-batch: IDs preserved (Phase 5A opportunistic batching)", async () => {
        let localCalls = 0;
        let receivedSegments: Array<{ id: number; text: string }> = [];
        let finishFirst: any;

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            provider: 'local_qwen',
            backendTranslateLocalFn: async (segments) => {
                localCalls++;
                receivedSegments = segments;
                if (segments[0].id === 100) {
                    await new Promise(r => { finishFirst = r; });
                    return { successful_segments: [{ id: 100, translation: "Hold" }], failed_ids: [] };
                }
                return {
                    successful_segments: [
                        { id: 101, translation: "译文 101" },
                        { id: 102, translation: "译文 102" },
                    ],
                    failed_ids: [],
                };
            },
        });

        // Hold model with segment 100 so 101 and 102 accumulate
        const pHold = scheduler.enqueue({ id: "s0", text: "Hold segment", sequenceId: 100 });
        await new Promise(r => setTimeout(r, 10));

        const p1 = scheduler.enqueue({ id: "s1", text: "one two three four five six seven eight nine ten", sequenceId: 101 });
        const p2 = scheduler.enqueue({ id: "s2", text: "one two three four five six seven eight nine ten", sequenceId: 102 });

        finishFirst();

        const [rHold, r1, r2] = await Promise.all([pHold, p1, p2]);

        assert.equal(localCalls, 2, "1 hold call + 1 batch call for 2 accumulated segments");
        assert.equal(receivedSegments.length, 2);
        assert.equal(receivedSegments[0].id, 101);
        assert.equal(receivedSegments[1].id, 102);
        assert.equal(r1, "译文 101");
        assert.equal(r2, "译文 102");
    });

    test("TEST 3: Three-segment micro-batch: IDs preserved (Phase 5A opportunistic batching)", async () => {
        let localCalls = 0;
        let receivedSegments: Array<{ id: number; text: string }> = [];
        let finishFirst: any;

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            provider: 'local_qwen',
            backendTranslateLocalFn: async (segments) => {
                localCalls++;
                receivedSegments = segments;
                if (segments[0].id === 300) {
                    await new Promise(r => { finishFirst = r; });
                    return { successful_segments: [{ id: 300, translation: "Hold" }], failed_ids: [] };
                }
                return {
                    successful_segments: [
                        { id: 301, translation: "第一句" },
                        { id: 302, translation: "第二句" },
                        { id: 303, translation: "第三句" },
                    ],
                    failed_ids: [],
                };
            },
        });

        const pHold = scheduler.enqueue({ id: "s0", text: "Hold segment", sequenceId: 300 });
        await new Promise(r => setTimeout(r, 10));

        const p1 = scheduler.enqueue({ id: "s1", text: "word1 word2", sequenceId: 301 });
        const p2 = scheduler.enqueue({ id: "s2", text: "word3 word4", sequenceId: 302 });
        const p3 = scheduler.enqueue({ id: "s3", text: "word5 word6", sequenceId: 303 });

        finishFirst();

        const [rHold, r1, r2, r3] = await Promise.all([pHold, p1, p2, p3]);

        assert.equal(localCalls, 2, "1 hold call + 1 batch call when 3 segments accumulate");
        assert.equal(receivedSegments.length, 3);
        assert.deepEqual(receivedSegments.map(s => s.id), [301, 302, 303]);
        assert.equal(r1, "第一句");
        assert.equal(r2, "第二句");
        assert.equal(r3, "第三句");
    });

    test("TEST 4: Local malformed response: valid IDs preserved, invalid IDs fail safely", async () => {
        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            provider: 'local_qwen',
            backendTranslateLocalFn: async () => {
                return {
                    successful_segments: [
                        { id: 401, translation: "有效 401" },
                    ],
                    failed_ids: [402],
                };
            },
        });

        const p1 = scheduler.enqueue({ id: "s1", text: "one two three four five six seven eight nine ten", sequenceId: 401 });
        const p2 = scheduler.enqueue({ id: "s2", text: "one two three four five six seven eight nine ten", sequenceId: 402 });

        const [r1, r2] = await Promise.all([p1, p2]);

        assert.equal(r1, "有效 401", "Valid ID 401 must resolve translation");
        assert.equal(r2, null, "Invalid/failed ID 402 must fail safely with null");
    });

    test("TEST 5: Local provider failure: NO Groq call", async () => {
        let groqCalls = 0;

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            provider: 'local_qwen',
            backendTranslateLocalFn: async () => {
                throw new Error("Local sidecar connection lost");
            },
            backendTranslateGroqFn: async () => {
                groqCalls++;
                return "groq fallback";
            },
        });

        const res = await scheduler.enqueue({ id: "s1", text: "Hello world test", sequenceId: 501 });

        assert.equal(res, null, "Local failure must resolve null");
        assert.equal(groqCalls, 0, "STRICT LOCAL PRIVACY: Must NOT make any Groq HTTP call on local failure");
    });

    test("TEST 6: Local provider failure: NO Gemini call", async () => {
        let geminiCalls = 0;

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            provider: 'local_qwen',
            backendTranslateLocalFn: async () => {
                return { successful_segments: [], failed_ids: [601] };
            },
            backendTranslateGeminiFn: async () => {
                geminiCalls++;
                return "gemini fallback";
            },
        });

        const res = await scheduler.enqueue({ id: "s1", text: "Hello world test", sequenceId: 601 });

        assert.equal(res, null, "Local failure must resolve null");
        assert.equal(geminiCalls, 0, "STRICT LOCAL PRIVACY: Must NOT make any Gemini HTTP call on local failure");
    });

    test("TEST 7: Existing Groq provider behavior remains unchanged", async () => {
        let groqCalls = 0;

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            provider: 'groq',
            backendTranslateGroqFn: async (text) => {
                groqCalls++;
                return "Groq 默认翻译结果";
            },
        });

        const res = await scheduler.enqueue({ id: "s1", text: "Test Groq default path", sequenceId: 701 });

        assert.equal(res, "Groq 默认翻译结果");
        assert.equal(groqCalls, 1);
    });

    test("TEST 8: Existing Gemini fallback behavior remains unchanged", async () => {
        let groqCalls = 0;
        let geminiCalls = 0;

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            provider: 'groq',
            backendTranslateGroqFn: async () => {
                groqCalls++;
                throw new Error("HTTP 500 Groq Server Error");
            },
            backendTranslateGeminiFn: async () => {
                geminiCalls++;
                return "Gemini 降级翻译结果";
            },
        });

        const res = await scheduler.enqueue({ id: "s1", text: "Test Gemini fallback", sequenceId: 801 });

        assert.equal(res, "Gemini 降级翻译结果");
        assert.equal(groqCalls, 2, "Tries groq primary and secondary model");
        assert.equal(geminiCalls, 1, "Falls back to Gemini when groq fails in cloud mode");
    });

    test("TEST 9: Existing 6000ms batching timeout remains unchanged for Cloud (Groq)", async () => {
        let groqCalls = 0;

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            provider: 'groq',
            backendTranslateGroqFn: async (text) => {
                groqCalls++;
                return "超时后刷新的单句";
            },
        });

        const start = Date.now();
        const p1 = scheduler.enqueue({ id: "s1", text: "short text", sequenceId: 901 });

        const res = await p1;
        const elapsed = Date.now() - start;

        assert.equal(res, "超时后刷新的单句");
        assert.equal(groqCalls, 1);
        assert.ok(elapsed >= 5900, `Must wait ~6000ms before auto-flushing short segment (elapsed: ${elapsed}ms)`);
    });

    test("TEST 10: Existing TEST R classroom cadence remains unchanged for Cloud (Groq)", async () => {
        let groqCalls = 0;

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            provider: 'groq',
            backendTranslateGroqFn: async (text) => {
                groqCalls++;
                return JSON.stringify([
                    { id: 1001, translation: "译文_1001" },
                    { id: 1002, translation: "译文_1002" },
                ]);
            },
        });

        // 1. Segment A: 7 words
        const p1 = scheduler.enqueue({ id: "s1", text: "one two three four five six seven", sequenceId: 1001 });

        // 2. Wait 4 seconds
        await new Promise(r => setTimeout(r, 4000));

        assert.equal(groqCalls, 0, "Buffer should hold segment A while under 20 words");

        // 3. Segment B: 16 words -> combined = 23 words >= 20 words -> Immediate flush
        const p2 = scheduler.enqueue({ id: "s2", text: "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen", sequenceId: 1002 });

        const [r1, r2] = await Promise.all([p1, p2]);

        assert.equal(groqCalls, 1, "Must flush immediately upon reaching 23 combined words");
        assert.equal(r1, "译文_1001");
        assert.equal(r2, "译文_1002");
    });

    test("TEST 11: No duplicate sequence IDs delivered to subtitle callback", async () => {
        const deliveredIds: number[] = [];

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            provider: 'local_qwen',
            backendTranslateLocalFn: async (segments) => {
                return {
                    successful_segments: segments.map(s => ({ id: s.id, translation: `OK_${s.id}` })),
                    failed_ids: [],
                };
            },
        });

        const p1 = scheduler.enqueue({ id: "s1", text: "one two three four five six seven eight nine ten", sequenceId: 1101 })
            .then(res => { if (res) deliveredIds.push(1101); return res; });
        const p2 = scheduler.enqueue({ id: "s2", text: "one two three four five six seven eight nine ten", sequenceId: 1102 })
            .then(res => { if (res) deliveredIds.push(1102); return res; });

        await Promise.all([p1, p2]);

        assert.deepEqual(deliveredIds, [1101, 1102]);
        assert.equal(new Set(deliveredIds).size, 2, "No duplicate sequence IDs delivered");
    });

    test("TEST 12: No missing valid sequence IDs caused by Local provider mapping", async () => {
        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            provider: 'local_qwen',
            backendTranslateLocalFn: async (segments) => {
                return {
                    successful_segments: [
                        { id: 1201, translation: "第一句" },
                        { id: 1202, translation: "第二句" },
                        { id: 1203, translation: "第三句" },
                    ],
                    failed_ids: [],
                };
            },
        });

        const p1 = scheduler.enqueue({ id: "s1", text: "word1 word2", sequenceId: 1201 });
        const p2 = scheduler.enqueue({ id: "s2", text: "word3 word4", sequenceId: 1202 });
        const p3 = scheduler.enqueue({ id: "s3", text: "word5 word6", sequenceId: 1203 });

        const results = await Promise.all([p1, p2, p3]);

        assert.deepEqual(results, ["第一句", "第二句", "第三句"]);
        assert.ok(results.every(Boolean), "No valid sequence IDs dropped by Local mapping");
    });

});
