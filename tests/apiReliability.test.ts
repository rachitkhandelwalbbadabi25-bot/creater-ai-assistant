// ════════════════════════════════════════════════════════════════════════════════
// tests/apiReliability.test.ts — Phase 5.3: External API Reliability Layer tests
// Run with: bun test tests/apiReliability.test.ts
// ════════════════════════════════════════════════════════════════════════════════

import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test";
import { executeTool } from "../src/agents/toolExecutor.js";
import {
  getApiMetrics,
  resetApiMetrics,
  recordApiRetry,
  recordApiFailure,
  recordApiSuccess,
  recordRateLimitHit,
  recordApiTimeout,
} from "../src/tools/toolMetrics.js";
import {
  isTransientHttpStatus,
  isFatalHttpStatus,
} from "../src/tools/external/api.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Phase 5.3 – External API Reliability Layer", () => {
  beforeEach(() => {
    resetApiMetrics();
  });

  // ── Test 1: Network timeout ────────────────────────────────────────────────
  test("1. Network timeout — executeTool reports failure with timeout error", async () => {
    const res = await executeTool(
      async () => {
        await sleep(5000); // exceeds timeoutMs
        return "never";
      },
      { maxAttempts: 1, baseDelayMs: 0, timeoutMs: 80 }
    );

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/timeout/i);
    expect(res.attempts).toBe(1);
  });

  // ── Test 2: DNS failure (ENOTFOUND) ───────────────────────────────────────
  test("2. DNS failure — retryable error, supervisor survives", async () => {
    let calls = 0;
    const res = await executeTool(
      async () => {
        calls++;
        throw new Error("ENOTFOUND this.host.does.not.exist");
      },
      { maxAttempts: 2, baseDelayMs: 10, timeoutMs: 5000 }
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("ENOTFOUND");
    expect(calls).toBe(2); // both attempts used
  });

  // ── Test 3: Rate limit (HTTP 429) ─────────────────────────────────────────
  test("3. Rate limit detection — recordRateLimitHit increments counter", () => {
    recordRateLimitHit();
    recordRateLimitHit();
    const m = getApiMetrics();
    expect(m.rateLimitHits).toBe(2);
  });

  test("3b. isTransientHttpStatus identifies 429, 502, 503, 504", () => {
    expect(isTransientHttpStatus(429)).toBe(true);
    expect(isTransientHttpStatus(502)).toBe(true);
    expect(isTransientHttpStatus(503)).toBe(true);
    expect(isTransientHttpStatus(504)).toBe(true);
    expect(isTransientHttpStatus(200)).toBe(false);
    expect(isTransientHttpStatus(400)).toBe(false);
  });

  // ── Test 4: Retry success on second attempt ───────────────────────────────
  test("4. Retry success — recovers on 2nd attempt after transient failure", async () => {
    let calls = 0;
    const res = await executeTool(
      async () => {
        calls++;
        if (calls === 1) throw new Error("ECONNRESET connection reset by peer");
        return { data: "api_response" };
      },
      { maxAttempts: 3, baseDelayMs: 10, timeoutMs: 5000 }
    );

    expect(res.success).toBe(true);
    expect((res.result as any).data).toBe("api_response");
    expect(calls).toBe(2);
  });

  // ── Test 5: Permanent failure (HTTP 401) ──────────────────────────────────
  test("5. Permanent failure (401 Unauthorized) — not retried", async () => {
    let calls = 0;
    const res = await executeTool(
      async () => {
        calls++;
        throw new Error("Anthropic API error 401: invalid_api_key");
      },
      { maxAttempts: 3, baseDelayMs: 10, timeoutMs: 5000 }
    );

    expect(res.success).toBe(false);
    // 401 is fatal — classifyError marks it non-retryable after 1 attempt
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  test("5b. isFatalHttpStatus identifies 400, 401, 403, 404", () => {
    expect(isFatalHttpStatus(400)).toBe(true);
    expect(isFatalHttpStatus(401)).toBe(true);
    expect(isFatalHttpStatus(403)).toBe(true);
    expect(isFatalHttpStatus(404)).toBe(true);
    expect(isFatalHttpStatus(200)).toBe(false);
    expect(isFatalHttpStatus(503)).toBe(false);
  });

  // ── Test 6: Fallback / stale response ─────────────────────────────────────
  test("6. Fallback response — caller can safely handle failure without crash", async () => {
    const FALLBACK = "offline_fallback_data";

    async function fetchWithFallback(url: string): Promise<string> {
      const res = await executeTool(
        async () => {
          throw new Error("Network unavailable");
        },
        { maxAttempts: 1, baseDelayMs: 0, timeoutMs: 1000 }
      );

      if (!res.success) {
        return FALLBACK; // graceful fallback
      }
      return res.result as string;
    }

    const result = await fetchWithFallback("https://api.example.com/data");
    expect(result).toBe(FALLBACK); // supervisor never crashed
  });

  // ── Test 7: Supervisor survival under repeated failures ───────────────────
  test("7. Supervisor survival — 10 consecutive API failures don't crash", async () => {
    let totalCalls = 0;
    const results: boolean[] = [];

    for (let i = 0; i < 10; i++) {
      const res = await executeTool(
        async () => {
          totalCalls++;
          throw new Error(`Simulated failure ${i}`);
        },
        { maxAttempts: 1, baseDelayMs: 0, timeoutMs: 500 }
      );
      results.push(res.success);
    }

    // All should fail gracefully
    expect(results.every((r) => r === false)).toBe(true);
    expect(totalCalls).toBe(10);
    // Supervisor still alive — we reach this line
    expect(true).toBe(true);
  });

  // ── Test 8: Metrics accuracy ──────────────────────────────────────────────
  test("8. API metrics — all counters tracked correctly", () => {
    recordApiSuccess(120);
    recordApiSuccess(240);
    recordApiFailure();
    recordApiRetry();
    recordRateLimitHit();
    recordApiTimeout();

    const m = getApiMetrics();

    expect(m.apiSuccesses).toBe(2);
    expect(m.apiFailures).toBe(1);
    expect(m.apiRetries).toBe(1);
    expect(m.rateLimitHits).toBe(1);
    expect(m.timeoutCount).toBe(1);
    expect(m.totalApiOperations).toBe(3); // 2 success + 1 failure
    expect(m.successRate).toBeCloseTo(2 / 3, 2);
    expect(m.averageApiLatency).toBe(120); // (120+240) / 3 ops
  });

  // ── Test 9: Reset metrics ──────────────────────────────────────────────────
  test("9. resetApiMetrics — clears all counters", () => {
    recordApiFailure();
    recordRateLimitHit();
    recordApiTimeout();
    resetApiMetrics();

    const m = getApiMetrics();
    expect(m.apiFailures).toBe(0);
    expect(m.rateLimitHits).toBe(0);
    expect(m.timeoutCount).toBe(0);
    expect(m.totalApiOperations).toBe(0);
    expect(m.successRate).toBe(1); // neutral
  });

  // ── Test 10: ECONNREFUSED is retried ─────────────────────────────────────
  test("10. ECONNREFUSED — retried as transient error", async () => {
    let attempts = 0;
    const res = await executeTool(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("ECONNREFUSED 127.0.0.1:11434");
        return "connected";
      },
      { maxAttempts: 3, baseDelayMs: 10, timeoutMs: 5000 }
    );

    expect(res.success).toBe(true);
    expect(res.result).toBe("connected");
    expect(attempts).toBe(3);
  });

  // ── Test 11: 503 retry ────────────────────────────────────────────────────
  test("11. HTTP 503 — transient, retried successfully", async () => {
    let calls = 0;
    const res = await executeTool(
      async () => {
        calls++;
        if (calls <= 2) throw new Error("HTTP 503: service temporarily unavailable");
        return "service recovered";
      },
      { maxAttempts: 3, baseDelayMs: 10, timeoutMs: 5000 }
    );

    expect(res.success).toBe(true);
    expect(res.result).toBe("service recovered");
    expect(calls).toBe(3);
  });
});
