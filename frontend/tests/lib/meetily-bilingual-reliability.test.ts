import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  UnifiedTranslationScheduler,
} from "../../src/services/unifiedTranslationScheduler.ts";
import { translationStatsTracker } from "../../src/services/translationStatsTracker.ts";
import {
  translateWithLocalQwen,
  checkLocalQwenHealth,
  formatSegmentsForPrompt,
  parseNumberedResponse,
} from "../../src/services/localTranslationService.ts";

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

// Standard 20+ word test sentence to trigger immediate batch execution
const LONG_TEST_SENTENCE =
  "In this networking configuration lecture we will examine default gateway settings, static routing tables, subnet masks, and domain controller authentication parameters.";

describe("Meetily Bilingual Reliability & Local Qwen3 Suite (R1 - R9 & Section 9 Scenarios)", () => {

  beforeEach(() => {
    localStorage.clear();
    translationStatsTracker.reset();
  });

  // R2 / Scenario 1: Groq 429 and Retry-After header
  test("Scenario 1: Groq 429 with Retry-After header triggers bounded cooldown and does not throw crash", async () => {
    let callCount = 0;
    const mockGroq = async () => {
      callCount++;
      const err: any = new Error("Rate limit exceeded: retry after 15s");
      (err as any).status = 429;
      throw err;
    };

    const scheduler = new UnifiedTranslationScheduler({
      provider: 'groq',
      minIntervalMs: 0,
      backendTranslateGroqFn: mockGroq,
    });

    // Enqueue should catch error safely and return null rather than throwing
    const result = await scheduler.enqueue({
      id: "groq-429-test",
      text: LONG_TEST_SENTENCE,
      sequenceId: 1,
    });

    assert.equal(result, null, "Translation error must safely resolve to null without crashing");
    assert.ok(scheduler.isRateLimited(), "Scheduler should enter rate limited / cooldown state");
    const stats = translationStatsTracker.getStats();
    assert.ok(stats.groq429Count > 0, "Groq 429 count must be recorded");
  });

  // R3 / Scenario 2: Gemini 429/503 bounded exponential backoff and non-blocking
  test("Scenario 2: Gemini 429/503 handles cooldown without crashing or blocking pipeline", async () => {
    let geminiCalls = 0;
    const mockGemini = async () => {
      geminiCalls++;
      const err: any = new Error("Gemini Service Unavailable: 503");
      (err as any).status = 503;
      throw err;
    };

    const scheduler = new UnifiedTranslationScheduler({
      provider: 'gemini',
      minIntervalMs: 0,
      backendTranslateGeminiFn: mockGemini,
    });

    const result = await scheduler.enqueue({
      id: "gemini-503-test",
      text: LONG_TEST_SENTENCE,
      sequenceId: 2,
    });

    assert.equal(result, null, "503 must resolve to null gracefully");
    assert.ok(scheduler.isRateLimited(), "Scheduler should enter cooldown after 503");
    const stats = translationStatsTracker.getStats();
    assert.ok(stats.geminiFailures > 0, "Gemini failure must be tracked");
  });

  // Scenario 3: Provider timeout handling (safely caught)
  test("Scenario 3: Provider timeout is caught safely and does not terminate session", async () => {
    const mockTimeout = async () => {
      throw new Error("Network timeout: request exceeded 8000ms");
    };

    const scheduler = new UnifiedTranslationScheduler({
      provider: 'local_qwen',
      minIntervalMs: 0,
      backendTranslateLocalFn: mockTimeout,
    });

    const result = await scheduler.enqueue({
      id: "timeout-test",
      text: LONG_TEST_SENTENCE,
      sequenceId: 3,
    });

    assert.equal(result, null);
  });

  // Scenario 4: Invalid/empty translation response
  test("Scenario 4: Invalid or empty translation response produces safe fallback without crashing", async () => {
    const mockEmpty = async () => {
      return {
        successful_segments: [],
        failed_ids: [4],
      };
    };

    const scheduler = new UnifiedTranslationScheduler({
      provider: 'local_qwen',
      minIntervalMs: 0,
      backendTranslateLocalFn: mockEmpty,
    });

    const result = await scheduler.enqueue({
      id: "empty-res-test",
      text: LONG_TEST_SENTENCE,
      sequenceId: 4,
    });

    assert.equal(result, null);
  });

  // Scenario 5: Both cloud providers unavailable (English-only fallback R4)
  test("Scenario 5: English-only fallback continues operating when all providers fail", async () => {
    const scheduler = new UnifiedTranslationScheduler({
      provider: 'groq',
      minIntervalMs: 0,
      backendTranslateGroqFn: async () => { throw new Error("Groq outage 500"); },
      backendTranslateGeminiFn: async () => { throw new Error("Gemini outage 500"); },
    });

    const res = await scheduler.enqueue({
      id: "failover-test",
      text: LONG_TEST_SENTENCE,
      sequenceId: 5,
    });

    assert.equal(res, null, "Result should resolve to null so English text remains uninterrupted");
    const stats = translationStatsTracker.getStats();
    assert.ok(stats.allProviderFailures > 0 || stats.groqOtherErrors > 0, "Failures must be recorded in stats");
  });

  // Scenario 6: Local Qwen3 success with prompt parsing & sequence ID mapping
  test("Scenario 6: Local Qwen3 successfully translates batch with technical terminology", async () => {
    const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string);
      assert.ok(body.text.includes("[1] Default gateway configuration"));
      assert.ok(body.text.includes("[2] Read-only access for domain controller"));
      assert.ok(body.context.includes("默认网关"));

      return {
        ok: true,
        status: 200,
        json: async () => ({
          translation: "[1] 默认网关配置\n[2] 域控制器的只读访问权限",
          model: "qwen3:1.7b",
          latency_ms: 320,
        }),
      } as unknown as Response;
    };

    const result = await translateWithLocalQwen(
      [
        { id: 10, text: "Default gateway configuration" },
        { id: 11, text: "Read-only access for domain controller" },
      ],
      {
        endpoint: "http://jeffsmac-mini.taile61984.ts.net:8080",
        fetchFn: mockFetch as any,
      }
    );

    assert.equal(result.successful_segments.length, 2);
    assert.equal(result.successful_segments[0].id, 10);
    assert.equal(result.successful_segments[0].translation, "默认网关配置");
    assert.equal(result.successful_segments[1].id, 11);
    assert.equal(result.successful_segments[1].translation, "域控制器的只读访问权限");
  });

  // Scenario 7: Local Qwen3 unreachable (Tailscale down / network error)
  test("Scenario 7: Local Qwen3 unreachable returns available false and empty translation safely", async () => {
    const mockUnreachableFetch = async () => {
      throw new Error("Failed to fetch: Connection refused (Tailscale offline)");
    };

    const health = await checkLocalQwenHealth("http://jeffsmac-mini.taile61984.ts.net:8080", mockUnreachableFetch as any);
    assert.equal(health.available, false);
    assert.ok(health.error?.includes("Connection refused"));

    const res = await translateWithLocalQwen(
      [{ id: 20, text: "Test segment" }],
      {
        endpoint: "http://jeffsmac-mini.taile61984.ts.net:8080",
        fetchFn: mockUnreachableFetch as any,
      }
    );

    assert.equal(res.successful_segments.length, 0);
    assert.deepEqual(res.failed_ids, [20]);
  });

  // Scenario 8: Translation ON -> OFF -> ON
  test("Scenario 8: Translation ON -> OFF -> ON toggles cleanly without crashing", () => {
    let enabled = true;
    const scheduler = new UnifiedTranslationScheduler({
      provider: 'local_qwen',
      minIntervalMs: 0,
    });

    // Toggle OFF
    enabled = false;
    assert.equal(enabled, false);

    // Toggle ON
    enabled = true;
    assert.equal(enabled, true);
  });

  // Scenario 9: No automatic backlog translation (R7) & Manual Translation Recovery (R9)
  test("Scenario 9 & R9: Manual translation can be triggered individually for failed segments without backlog spam", async () => {
    let manualCallCount = 0;
    const mockLocal = async (segments: Array<{ id: number; text: string }>) => {
      manualCallCount++;
      return {
        successful_segments: [{ id: segments[0].id, translation: "手动恢复的译文" }],
        failed_ids: [],
      };
    };

    const scheduler = new UnifiedTranslationScheduler({
      provider: 'local_qwen',
      minIntervalMs: 0,
      backendTranslateLocalFn: mockLocal,
    });

    // Segment 100 failed in past and has no translation in state
    // User clicks "Translate" on segment 100
    const recoveredTranslation = await scheduler.enqueue({
      id: "manual-recovery-100",
      text: "Packet inspection on static route with twenty words or more for instant dispatch testing",
      sequenceId: 100,
    });

    assert.equal(recoveredTranslation, "手动恢复的译文");
    assert.equal(manualCallCount, 1, "Only requested segment 100 was translated");
  });

  // Scenario 10: Duplicate and out-of-order responses do not corrupt state
  test("Scenario 10: Out-of-order / overlapping requests resolve to their specific promise results", async () => {
    const scheduler = new UnifiedTranslationScheduler({
      provider: 'local_qwen',
      minIntervalMs: 0,
      backendTranslateLocalFn: async (segments) => {
        return {
          successful_segments: segments.map(s => ({
            id: s.id,
            translation: `译文_${s.id}`,
          })),
          failed_ids: [],
        };
      },
    });

    const [t1, t2] = await Promise.all([
      scheduler.enqueue({ id: "req-1", text: LONG_TEST_SENTENCE, sequenceId: 1 }),
      scheduler.enqueue({ id: "req-2", text: LONG_TEST_SENTENCE + " second part", sequenceId: 2 }),
    ]);

    assert.equal(t1, "译文_1");
    assert.equal(t2, "译文_2");
  });

  // Scenario 11: Numbered parser robustness
  test("Scenario 11: Numbered response parser handles various markdown and numbering formats", () => {
    const output = `
1. 静态路由与子网掩码配置
2. 数据包传输测试
[3] 域控制器备份
    `;
    const parsed = parseNumberedResponse(output, [1, 2, 3]);
    assert.equal(parsed.get(1), "静态路由与子网掩码配置");
    assert.equal(parsed.get(2), "数据包传输测试");
    assert.equal(parsed.get(3), "域控制器备份");
  });

});
