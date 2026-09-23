import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
    UnifiedTranslationScheduler,
    GROQ_CANDIDATE_MODELS,
    GEMINI_CANDIDATE_MODELS,
} from "../../src/services/unifiedTranslationScheduler.ts";
import { translationStatsTracker } from "../../src/services/translationStatsTracker.ts";

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
(globalThis as any).localStorage.setItem('meetily_cloud_translation_enabled', 'true');


describe("Groq Primary & Gemini Fallback Translation Scheduler Regression Tests", () => {

    beforeEach(() => {
        translationStatsTracker.reset();
    });

    test("TEST A: One >=20-word segment translates immediately", async () => {
        let requestsIssued = 0;
        const mockGroq = async (text: string) => {
            requestsIssued++;
            return "长段落翻译结果";
        };

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            backendTranslateGroqFn: mockGroq,
        });

        // 20 words long segment
        const longText = "word ".repeat(20).trim();
        const promise = scheduler.enqueue({
            id: "long-1",
            text: longText,
            sequenceId: 1,
        });

        const res = await promise;
        assert.equal(res, "长段落翻译结果");
        assert.equal(requestsIssued, 1, "Should issue exactly 1 request immediately");
    });

    test("TEST B: Two short segments reach >=20 combined words and produce ONE provider request", async () => {
        let requestsIssued = 0;
        let lastRawPayload = "";

        const mockGroq = async (text: string) => {
            requestsIssued++;
            lastRawPayload = text;
            return JSON.stringify([
                { id: 101, translation: "短段落一" },
                { id: 102, translation: "短段落二" },
            ]);
        };

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            backendTranslateGroqFn: mockGroq,
        });

        // 10 words + 10 words = 20 words (triggers combined word threshold)
        const p1 = scheduler.enqueue({ id: "s1", text: "one two three four five six seven eight nine ten", sequenceId: 101 });
        const p2 = scheduler.enqueue({ id: "s2", text: "one two three four five six seven eight nine ten", sequenceId: 102 });

        const [r1, r2] = await Promise.all([p1, p2]);

        assert.equal(requestsIssued, 1, "Must produce exactly 1 HTTP request for both short segments");
        assert.equal(r1, "短段落一");
        assert.equal(r2, "短段落二");
        assert.ok(lastRawPayload.includes("101") && lastRawPayload.includes("102"));
    });

    test("TEST C: Three short segments trigger MAX_BATCH_SEGMENTS and produce ONE provider request", async () => {
        let requestsIssued = 0;

        const mockGroq = async () => {
            requestsIssued++;
            return JSON.stringify([
                { id: 1, translation: "译文一" },
                { id: 2, translation: "译文二" },
                { id: 3, translation: "译文三" },
            ]);
        };

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            backendTranslateGroqFn: mockGroq,
        });

        // 3 short segments of 2 words each (total 6 words, but count == 3 MAX_BATCH_SEGMENTS)
        const p1 = scheduler.enqueue({ id: "s1", text: "hello world", sequenceId: 1 });
        const p2 = scheduler.enqueue({ id: "s2", text: "good morning", sequenceId: 2 });
        const p3 = scheduler.enqueue({ id: "s3", text: "thank you", sequenceId: 3 });

        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

        assert.equal(requestsIssued, 1, "Must trigger flush on 3 segments");
        assert.equal(r1, "译文一");
        assert.equal(r2, "译文二");
        assert.equal(r3, "译文三");
    });

    test("TEST D: A short segment reaches MAX_BATCH_WAIT_MS and flushes", async () => {
        let requestsIssued = 0;

        const mockGroq = async (text: string) => {
            requestsIssued++;
            return "定时刷新的译文";
        };

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            backendTranslateGroqFn: mockGroq,
        });

        const p = scheduler.enqueue({ id: "s1", text: "hello", sequenceId: 50 });

        // Fast forward / wait for timer
        const res = await p;
        assert.equal(res, "定时刷新的译文");
        assert.equal(requestsIssued, 1);
    });

    test("TEST E: Stop Recording / session finalization flushes pending short segments", async () => {
        let requestsIssued = 0;

        const mockGroq = async (text: string) => {
            requestsIssued++;
            return "手动刷新的译文";
        };

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            backendTranslateGroqFn: mockGroq,
        });

        // Enqueue 1 short segment (would otherwise wait 2000ms)
        const p = scheduler.enqueue({ id: "s1", text: "short text", sequenceId: 99 });
        assert.equal(requestsIssued, 0, "Should be pending before flush");

        // Force flush via flushPendingBatch() or resetDisabledModels()
        scheduler.flushPendingBatch();

        const res = await p;
        assert.equal(res, "手动刷新的译文");
        assert.equal(requestsIssued, 1);
    });

    test("TEST F: Batch response translations map to the correct original sequence IDs", async () => {
        const mockGroq = async () => {
            // Out of order JSON array response
            return JSON.stringify([
                { id: 202, translation: "Second response" },
                { id: 201, translation: "First response" },
            ]);
        };

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            backendTranslateGroqFn: mockGroq,
        });

        const p1 = scheduler.enqueue({ id: "s1", text: "one two three four five six seven eight nine ten", sequenceId: 201 });
        const p2 = scheduler.enqueue({ id: "s2", text: "one two three four five six seven eight nine ten", sequenceId: 202 });

        const [r1, r2] = await Promise.all([p1, p2]);

        assert.equal(r1, "First response", "Sequence 201 must get 201 translation");
        assert.equal(r2, "Second response", "Sequence 202 must get 202 translation");
    });

    test("TEST G: Malformed batch response does not lose transcript segments", async () => {
        let callCount = 0;

        const mockGroq = async (text: string) => {
            callCount++;
            if (callCount === 1) {
                // Return malformed JSON for batch request
                return "Malformed non-json response text without IDs";
            }
            // Individual fallbacks succeed
            return "Fallback: " + text;
        };

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            backendTranslateGroqFn: mockGroq,
        });

        const p1 = scheduler.enqueue({ id: "s1", text: "one two three four five six seven eight nine ten", sequenceId: 301 });
        const p2 = scheduler.enqueue({ id: "s2", text: "one two three four five six seven eight nine ten", sequenceId: 302 });

        const [r1, r2] = await Promise.all([p1, p2]);

        assert.ok(r1?.startsWith("Fallback:"));
        assert.ok(r2?.startsWith("Fallback:"));
    });

    test("TEST H: Groq failure still reaches the existing Gemini fallback correctly", async () => {
        let groqCalled = 0;
        let geminiCalled = 0;

        const mockGroq = async () => {
            groqCalled++;
            throw new Error("HTTP 500 Internal Server Error");
        };

        const mockGemini = async (text: string) => {
            geminiCalled++;
            return "Gemini fallback translation";
        };

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            backendTranslateGroqFn: mockGroq,
            backendTranslateGeminiFn: mockGemini,
        });

        const res = await scheduler.enqueue({ id: "s1", text: "hello world long segment test text word count >= 20 " + "word ".repeat(20) });

        assert.equal(groqCalled, 2, "Tries Groq 20b and 120b");
        assert.equal(geminiCalled, 1, "Falls back to Gemini");
        assert.equal(res, "Gemini fallback translation");
    });

    test("TEST I: No duplicate sequence IDs or duplicate accepted translations", async () => {
        const translations: Array<{ seq: number; text: string }> = [];

        const mockGroq = async () => {
            return JSON.stringify([
                { id: 401, translation: "Unique Translation 401" },
                { id: 402, translation: "Unique Translation 402" },
            ]);
        };

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            backendTranslateGroqFn: mockGroq,
        });

        const p1 = scheduler.enqueue({ id: "s1", text: "one two three four five six seven eight nine ten", sequenceId: 401 })
            .then(t => { if (t) translations.push({ seq: 401, text: t }); });
        const p2 = scheduler.enqueue({ id: "s2", text: "one two three four five six seven eight nine ten", sequenceId: 402 })
            .then(t => { if (t) translations.push({ seq: 402, text: t }); });

        await Promise.all([p1, p2]);

        assert.equal(translations.length, 2);
        const seqs = translations.map(t => t.seq);
        assert.deepEqual(seqs.sort(), [401, 402]);
    });

    test("TEST J: Current RPM counts actual HTTP requests rather than transcript segments", async () => {
        const mockGroq = async () => {
            return JSON.stringify([
                { id: 1, translation: "Trans 1" },
                { id: 2, translation: "Trans 2" },
                { id: 3, translation: "Trans 3" },
            ]);
        };

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            backendTranslateGroqFn: mockGroq,
        });

        // Batch of 3 segments -> 1 HTTP request
        const p1 = scheduler.enqueue({ id: "s1", text: "hello", sequenceId: 1 });
        const p2 = scheduler.enqueue({ id: "s2", text: "world", sequenceId: 2 });
        const p3 = scheduler.enqueue({ id: "s3", text: "test", sequenceId: 3 });

        await Promise.all([p1, p2, p3]);

        const stats = translationStatsTracker.getStats();
        assert.equal(stats.groqRequests, 1, "Groq requests count must be 1");
        assert.equal(stats.current60sRpm, 1, "RPM must count 1 HTTP request, not 3 transcript segments");
    });

    test("TEST K: Peak rolling 60-second RPM is calculated correctly", async () => {
        translationStatsTracker.recordHttpRequestExecuted();
        translationStatsTracker.recordHttpRequestExecuted();
        translationStatsTracker.recordHttpRequestExecuted();

        const stats1 = translationStatsTracker.getStats();
        assert.equal(stats1.current60sRpm, 3);
        assert.equal(stats1.peak60sRpm, 3);
    });

    test("TEST L: API requests saved metric is calculated correctly", async () => {
        // Record a batch of 3 segments
        translationStatsTracker.recordBatchedSegments(3);

        const stats = translationStatsTracker.getStats();
        assert.equal(stats.batchedSegments, 3);
        assert.equal(stats.savedApiRequests, 2, "3 segments in 1 request saves 2 API requests");
    });

    test("TEST M: A failed batch does not poison subsequent translation attempts", async () => {
        let callCount = 0;

        const mockGroq = async (text: string) => {
            callCount++;
            if (callCount === 1) {
                throw new Error("HTTP 500 Temporary Server Error");
            }
            return "Successful translation after failure";
        };

        const scheduler = new UnifiedTranslationScheduler({
            minIntervalMs: 0,
            backendTranslateGroqFn: mockGroq,
        });

        // First attempt (batch or single) fails
        const p1 = scheduler.enqueue({ id: "s1", text: "one two three four five six seven eight nine ten", sequenceId: 501 });
        const p2 = scheduler.enqueue({ id: "s2", text: "one two three four five six seven eight nine ten", sequenceId: 502 });

        // Let first attempt complete (which falls back and retries individually or fails gracefully)
        await Promise.all([p1, p2]);

        // Subsequent segment must be able to execute normally
        const res3 = await scheduler.enqueue({ id: "s3", text: "word ".repeat(25), sequenceId: 503 });
        assert.equal(res3, "Successful translation after failure");
    });

    test("TEST N: Production-path integration test via translateWithGemini entry point", async () => {
        let httpRequestsCount = 0;
        let receivedPayload = "";

        const mockGroq = async (text: string) => {
            httpRequestsCount++;
            receivedPayload = text;
            return JSON.stringify([
                { id: 601, translation: "交换机接收数据帧。" },
                { id: 602, translation: "然后转发该数据帧。" },
                { id: 603, translation: "发往所有其他接口。" },
            ]);
        };

        const { translateWithGemini, setCloudTranslationEnabled, unifiedTranslationScheduler } = await import("../../src/services/geminiTranslationService.ts");
        unifiedTranslationScheduler.resetDisabledModels();
        unifiedTranslationScheduler.setBackendTranslateGroqFn(mockGroq);
        setCloudTranslationEnabled(true);

        // Record eligible segments as TranscriptContext.requestTranslation does in production
        translationStatsTracker.recordEligibleSegment();
        const p1 = translateWithGemini("The switch receives frame.", undefined, undefined, 601);

        translationStatsTracker.recordEligibleSegment();
        const p2 = translateWithGemini("And then it forwards frame.", undefined, undefined, 602);

        translationStatsTracker.recordEligibleSegment();
        const p3 = translateWithGemini("Out all the other interfaces.", undefined, undefined, 603);

        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

        const stats = translationStatsTracker.getStats();

        assert.equal(httpRequestsCount, 1, "Must issue exactly 1 Groq HTTP request for 3 short segments");
        assert.equal(stats.totalEligible, 3, "Must record 3 eligible segments");
        assert.equal(stats.groqRequests, 1, "Must record 1 Groq request in stats");
        assert.equal(stats.batchedSegments, 3, "Must record 3 batched segments");
        assert.equal(stats.savedApiRequests, 2, "Must record 2 saved API requests");

        assert.equal(r1, "交换机接收数据帧。");
        assert.equal(r2, "然后转发该数据帧。");
        assert.equal(r3, "发往所有其他接口。");
        assert.ok(receivedPayload.includes("601") && receivedPayload.includes("602") && receivedPayload.includes("603"));
    });


    test("TEST O: Production-path timeout test — 1 short segment flushes after 6000ms", async () => {
        let httpRequestsCount = 0;

        const mockGroq = async (text: string) => {
            httpRequestsCount++;
            return "超时刷新的译文";
        };

        const { translateWithGemini, setCloudTranslationEnabled, unifiedTranslationScheduler } = await import("../../src/services/geminiTranslationService.ts");
        unifiedTranslationScheduler.resetDisabledModels();
        unifiedTranslationScheduler.setBackendTranslateGroqFn(mockGroq);
        setCloudTranslationEnabled(true);

        const promise = translateWithGemini("Short segment test text.", undefined, undefined, 701);

        // Before timeout flushes
        assert.equal(httpRequestsCount, 0, "HTTP request count must be 0 before 6000ms timeout");

        const result = await promise;
        assert.equal(result, "超时刷新的译文");
        assert.equal(httpRequestsCount, 1, "HTTP request count must be 1 after 6000ms timeout");
    });

    test("TEST P: Buffer persistence test — pending buffer survives across separate events", async () => {
        const mockGroq = async () => {
            return JSON.stringify([
                { id: 801, translation: "译文A" },
                { id: 802, translation: "译文B" },
            ]);
        };

        const { translateWithGemini, setCloudTranslationEnabled, unifiedTranslationScheduler } = await import("../../src/services/geminiTranslationService.ts");
        unifiedTranslationScheduler.resetDisabledModels();
        unifiedTranslationScheduler.setBackendTranslateGroqFn(mockGroq);
        setCloudTranslationEnabled(true);

        // Event A arrives
        const p1 = translateWithGemini("First short sentence.", undefined, undefined, 801);
        assert.equal(unifiedTranslationScheduler.getPendingBatchLength(), 1, "Buffer must contain 1 item after Event A");

        // Small delay simulating separate event cycle
        await new Promise(r => setTimeout(r, 50));

        // Event B arrives
        const p2 = translateWithGemini("Second short sentence.", undefined, undefined, 802);

        // Buffer persistence check
        assert.equal(unifiedTranslationScheduler.getPendingBatchLength(), 2, "Buffer must contain 2 items after Event B without resetting");

        // Force flush to resolve
        unifiedTranslationScheduler.flushPendingBatch();

        const [r1, r2] = await Promise.all([p1, p2]);
        assert.equal(r1, "译文A");
        assert.equal(r2, "译文B");
    });

    test("TEST Q: Deterministic punctuation-agnostic word counting", async () => {
        const { countEnglishWords } = await import("../../src/services/unifiedTranslationScheduler.ts");

        assert.equal(countEnglishWords("Okay."), 1, "'Okay.' must count as 1 word");
        assert.equal(countEnglishWords("The switch receives the frame."), 5, "Must count 5 words ignoring period");
        assert.equal(countEnglishWords("And then it forwards that frame out all the other interfaces."), 11, "Must count 11 words");
        assert.ok(countEnglishWords("So what we're going to do here is configure the interface and then verify that the router can communicate with the other network.") >= 20, "Must count >= 20 words as LONG");
    });

    test("TEST R: 4-second gap classroom cadence batching — Segment A (7 words) + Segment B (16 words) flushes immediately on word threshold", async () => {
        let httpRequestsCount = 0;

        const mockGroq = async (text: string) => {
            httpRequestsCount++;
            return JSON.stringify([
                { id: 901, translation: "第一句译文" },
                { id: 902, translation: "第二句译文" },
            ]);
        };

        const { translateWithGemini, setCloudTranslationEnabled, unifiedTranslationScheduler } = await import("../../src/services/geminiTranslationService.ts");
        unifiedTranslationScheduler.resetDisabledModels();
        unifiedTranslationScheduler.setBackendTranslateGroqFn(mockGroq);
        setCloudTranslationEnabled(true);

        // Segment A: 7 words
        translationStatsTracker.recordEligibleSegment();
        const p1 = translateWithGemini("The switch receives the frame right now.", undefined, undefined, 901);
        assert.equal(httpRequestsCount, 0, "No HTTP request immediately after Segment A (7 words)");

        // Wait 4000ms (simulating real classroom 4s speech pause)
        await new Promise(r => setTimeout(r, 4000));
        assert.equal(httpRequestsCount, 0, "No HTTP request at 4000ms (before 6000ms timeout)");

        // Segment B: 16 words (7 + 16 = 23 words >= 20 SHORT_SEGMENT_THRESHOLD)
        translationStatsTracker.recordEligibleSegment();
        const p2 = translateWithGemini("And then it forwards that frame out all the other interfaces on the local subnet.", undefined, undefined, 902);

        const [r1, r2] = await Promise.all([p1, p2]);

        const stats = translationStatsTracker.getStats();

        assert.equal(httpRequestsCount, 1, "Must issue exactly 1 HTTP request immediately when Segment B reaches word threshold");
        assert.equal(stats.totalEligible, 2, "Eligible segments must equal 2");
        assert.equal(stats.groqRequests, 1, "Groq HTTP requests must equal 1");
        assert.equal(stats.batchedSegments, 2, "Batched segments must equal 2");
        assert.equal(stats.savedApiRequests, 1, "Saved API requests must equal 1");
        assert.equal(r1, "第一句译文");
        assert.equal(r2, "第二句译文");
    });
});




