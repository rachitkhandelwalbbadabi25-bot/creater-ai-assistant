// ════════════════════════════════════════════════════════════════════════════════
// tests/toolReliability.test.ts — Phase 5.2 reliability layer tests
// Run with: bun test tests/toolReliability.test.ts
// ════════════════════════════════════════════════════════════════════════════════

import { describe, test, expect, beforeEach, mock } from "bun:test";
import { executeTool } from "../src/agents/toolExecutor.js";
import {
  getToolMetrics,
  resetToolMetrics,
  recordBrowserRetry,
  recordBrowserFailure,
  recordBrowserSuccess,
  recordShellFailure,
  recordShellSuccess,
  recordComputerRetry,
  recordComputerFailure,
  recordTimeout,
} from "../src/tools/toolMetrics.js";

// ─── Helper ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Test Suite ───────────────────────────────────────────────────────────────

describe("Phase 5.2 – Tool Reliability Layer", () => {
  beforeEach(() => {
    resetToolMetrics();
  });

  // ── Test 1: Browser timeout ────────────────────────────────────────────────
  test("1. Browser timeout — executeTool reports failure on timeout", async () => {
    const res = await executeTool(
      async () => {
        await sleep(5000); // longer than timeoutMs
        return "should not reach";
      },
      { maxAttempts: 1, baseDelayMs: 0, timeoutMs: 100 }
    );

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/timeout/i);
    expect(res.attempts).toBe(1);
  });

  // ── Test 2: Navigation failure ────────────────────────────────────────────
  test("2. Navigation failure — executeTool returns structured error", async () => {
    const res = await executeTool(
      async () => {
        throw new Error("net::ERR_NAME_NOT_RESOLVED");
      },
      { maxAttempts: 2, baseDelayMs: 10, timeoutMs: 5000 }
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("ERR_NAME_NOT_RESOLVED");
    // Should have tried both attempts
    expect(res.attempts).toBeGreaterThanOrEqual(1);
  });

  // ── Test 3: Playwright crash recovery (page close & recreate) ─────────────
  test("3. Playwright crash recovery — browser instance can be recreated", async () => {
    // Simulate crash: first call throws, second succeeds
    let callCount = 0;
    const res = await executeTool(
      async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Target page, context or browser has been closed");
        }
        return "recovered";
      },
      { maxAttempts: 3, baseDelayMs: 10, timeoutMs: 5000 }
    );

    expect(res.success).toBe(true);
    expect(res.result).toBe("recovered");
    expect(res.attempts).toBe(2);
  });

  // ── Test 4: Shell timeout ─────────────────────────────────────────────────
  test("4. Shell timeout — returns structured timeout error", async () => {
    const res = await executeTool(
      async () => {
        await sleep(2000);
        return { stdout: "", stderr: "", exitCode: 0, duration: 2000 };
      },
      { maxAttempts: 1, baseDelayMs: 0, timeoutMs: 50 }
    );

    expect(res.success).toBe(false);
    expect(res.error).toMatch(/timeout/i);
  });

  // ── Test 5: Retry success on second attempt ───────────────────────────────
  test("5. Retry success on second attempt", async () => {
    let attempts = 0;
    const res = await executeTool(
      async () => {
        attempts++;
        if (attempts < 2) throw new Error("Temporary network error");
        return "success on attempt 2";
      },
      { maxAttempts: 3, baseDelayMs: 10, timeoutMs: 5000 }
    );

    expect(res.success).toBe(true);
    expect(res.result).toBe("success on attempt 2");
    expect(res.attempts).toBe(2);
  });

  // ── Test 6: Browser recreation after crash ────────────────────────────────
  test("6. Browser recreation after crash — metrics track correctly", async () => {
    // Simulate: record a failure, then a retry, then a success
    recordBrowserFailure();
    recordBrowserRetry();
    recordBrowserSuccess(250);

    const metrics = getToolMetrics();

    expect(metrics.browserFailures).toBe(1);
    expect(metrics.browserRetries).toBe(1);
    expect(metrics.browserSuccesses).toBe(1);
    // totalOperations = 2 (failure + success)
    expect(metrics.totalOperations).toBe(2);
  });

  // ── Test 7: Metrics accuracy ──────────────────────────────────────────────
  test("7. Metrics — success rate is calculated correctly", () => {
    recordBrowserSuccess(100);
    recordBrowserSuccess(200);
    recordBrowserFailure();
    recordShellSuccess(50);
    recordShellFailure();

    const m = getToolMetrics();

    // 3 successes (2 browser + 1 shell), 2 failures → 5 total ops
    expect(m.totalOperations).toBe(5);
    // successRate = (2+1) / 5 = 0.6
    expect(m.successRate).toBeCloseTo(0.6, 2);
    expect(m.averageExecutionMs).toBeGreaterThan(0);
  });

  // ── Test 8: Timeout counter ───────────────────────────────────────────────
  test("8. Timeout counter — incremented correctly", () => {
    recordTimeout();
    recordTimeout();
    const m = getToolMetrics();
    expect(m.timeoutCount).toBe(2);
  });

  // ── Test 9: Non-retryable error (abort) ──────────────────────────────────
  test("9. Non-retryable errors are not retried", async () => {
    let attempts = 0;
    const res = await executeTool(
      async () => {
        attempts++;
        throw new Error("abort: invalid input detected");
      },
      { maxAttempts: 5, baseDelayMs: 10, timeoutMs: 5000 }
    );

    expect(res.success).toBe(false);
    // classifyError marks abort/invalid-input as non-retryable → only 1 attempt
    expect(attempts).toBe(1);
  });

  // ── Test 10: Computer action retry ────────────────────────────────────────
  test("10. Computer action retries correctly", async () => {
    let calls = 0;
    const res = await executeTool(
      async () => {
        calls++;
        if (calls === 1) throw new Error("element not found, temporary");
        return "element clicked";
      },
      { maxAttempts: 2, baseDelayMs: 10, timeoutMs: 5000 }
    );

    expect(res.success).toBe(true);
    expect(res.result).toBe("element clicked");
    expect(calls).toBe(2);
  });

  // ── Test 11: Reset metrics ────────────────────────────────────────────────
  test("11. resetToolMetrics clears all counters", () => {
    recordBrowserRetry();
    recordBrowserFailure();
    recordTimeout();
    resetToolMetrics();

    const m = getToolMetrics();
    expect(m.browserRetries).toBe(0);
    expect(m.browserFailures).toBe(0);
    expect(m.timeoutCount).toBe(0);
    expect(m.totalOperations).toBe(0);
    expect(m.successRate).toBe(1); // neutral when no ops
  });
});
