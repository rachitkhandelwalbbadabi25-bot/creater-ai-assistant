// tests/resilience.test.ts

import { describe, it, expect, beforeEach } from "bun:test";
import { CircuitBreaker } from "../src/resilience/circuitBreaker.js";
import { CircuitState } from "../src/resilience/types.js";
import { fallbackManager } from "../src/resilience/fallbackManager.js";
import { recoveryManager } from "../src/resilience/recoveryManager.js";
import { resilienceMetricsTracker } from "../src/resilience/resilienceMetrics.js";
import { evaluateAlerts, getActiveAlerts, clearAlerts } from "../src/monitoring/alerts.js";
import { getDashboard } from "../src/monitoring/dashboard.js";

// Helper async function that always fails
async function alwaysFail() {
  throw new Error("forced failure");
}

// Helper async function that succeeds after a delay
async function succeedAfter(ms: number) {
  return new Promise((resolve) => setTimeout(() => resolve("ok"), ms));
}

describe("Resilience Layer Tests", () => {
  beforeEach(() => {
    // Reset metrics and alerts before each test
    resilienceMetricsTracker.reset();
    clearAlerts();
  });

  it("Circuit opens after threshold failures", async () => {
    const breaker = new CircuitBreaker("test", { failureThreshold: 2, successThreshold: 1, resetTimeoutMs: 10 });
    await expect(breaker.execute(alwaysFail)).rejects.toThrow();
    await expect(breaker.execute(alwaysFail)).rejects.toThrow();
    // Third call should be blocked because circuit is OPEN
    await expect(breaker.execute(alwaysFail)).rejects.toThrow(/OPEN/);
    expect(breaker.getState()).toBe(CircuitState.OPEN); // CircuitState.OPEN
    const snap = resilienceMetricsTracker.getSnapshot();
    expect(snap.breakerTrips["test"]).toBe(1);
  });

  it("Circuit blocks execution while OPEN", async () => {
    const breaker = new CircuitBreaker("test2", { failureThreshold: 1, successThreshold: 1, resetTimeoutMs: 10 });
    await expect(breaker.execute(alwaysFail)).rejects.toThrow();
    await expect(breaker.execute(alwaysFail)).rejects.toThrow(/OPEN/);
    // Ensure no function execution occurs
    let called = false;
    const fn = async () => { called = true; };
    await expect(breaker.execute(fn)).rejects.toThrow(/OPEN/);
    expect(called).toBe(false);
  });

  it("Circuit transitions to HALF_OPEN after timeout", async () => {
    const breaker = new CircuitBreaker("test3", { failureThreshold: 1, successThreshold: 1, resetTimeoutMs: 5 });
    await expect(breaker.execute(alwaysFail)).rejects.toThrow();
    // wait for reset timeout
    await new Promise((r) => setTimeout(r, 10));
    // Now state should be HALF_OPEN and allow one trial
    const result = await breaker.execute(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
    expect(breaker.getState()).toBe(CircuitState.CLOSED); // CLOSED
  });

  it("Circuit resets to CLOSED after successful recovery", async () => {
    const breaker = new CircuitBreaker("test4", { failureThreshold: 1, successThreshold: 2, resetTimeoutMs: 5 });
    await expect(breaker.execute(alwaysFail)).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 10));
    // First success moves to HALF_OPEN then CLOSED, success count resets
    await breaker.execute(() => Promise.resolve("ok"));
    await breaker.execute(() => Promise.resolve("ok"));
    expect(breaker.getState()).toBe(CircuitState.CLOSED); // CLOSED
  });

  it("FallbackManager executes fallback correctly", async () => {
    const result = await fallbackManager.executeFallback("ollama", new Error("offline"));
    expect(result).toHaveProperty("model");
    const snap = resilienceMetricsTracker.getSnapshot();
    expect(snap.fallbackExecutions["ollama"]).toBe(1);
  });

  it("RecoveryManager resets open breakers", async () => {
    const breaker = new CircuitBreaker("test5", { failureThreshold: 1, successThreshold: 1, resetTimeoutMs: 5 });
    // Register test5 in breakerRegistry temporarily so runHealthRecovery will check it
    const { breakerRegistry } = await import("../src/resilience/circuitBreaker.js");
    breakerRegistry["test5"] = breaker;

    await expect(breaker.execute(alwaysFail)).rejects.toThrow();
    expect(breaker.getState()).toBe(CircuitState.OPEN); // OPEN
    await recoveryManager.runHealthRecovery();
    expect(breaker.getState()).toBe(CircuitState.CLOSED); // CLOSED after recovery

    // Clean up registry
    delete breakerRegistry["test5"];
  });

  it("RetryPolicy uses exponential backoff (mocked)", async () => {
    // Use the exponentialBackoff utility directly
    const { exponentialBackoff } = await import("../src/agents/toolExecutor.js");
    const delay1 = exponentialBackoff(1, 200);
    const delay2 = exponentialBackoff(2, 200);
    expect(delay2).toBeGreaterThan(delay1);
  });

  it("breakerRegistry returns correct breaker", async () => {
    const { breakerRegistry } = await import("../src/resilience/circuitBreaker.js");
    expect(breakerRegistry["browser"]).toBeDefined();
    expect(breakerRegistry["ollama"]).toBeDefined();
  });

  it("Resilience metrics increment correctly", async () => {
    const breaker = new CircuitBreaker("test6", { failureThreshold: 1, successThreshold: 1, resetTimeoutMs: 5 });
    await expect(breaker.execute(alwaysFail)).rejects.toThrow();
    const snap = resilienceMetricsTracker.getSnapshot();
    expect(snap.breakerTrips["test6"]).toBe(1);
    await fallbackManager.executeFallback("browser", new Error("fail"));
    const snap2 = resilienceMetricsTracker.getSnapshot();
    expect(snap2.fallbackExecutions["browser"]).toBe(1);
  });

  it("Dashboard exposes resilience metrics", async () => {
    const dash = await getDashboard();
    expect(dash.metrics).toHaveProperty("resilience");
    const res = dash.metrics.resilience as any;
    expect(res).toHaveProperty("breakerTrips");
    expect(res).toHaveProperty("openCircuits");
    expect(res).toHaveProperty("fallbackExecutions");
    expect(res).toHaveProperty("recoveryExecutions");
    expect(res).toHaveProperty("breakerResets");
  });

  it("Alert generated when circuit opens", async () => {
    const breaker = new CircuitBreaker("test7", { failureThreshold: 1, successThreshold: 1, resetTimeoutMs: 5 });
    const { breakerRegistry } = await import("../src/resilience/circuitBreaker.js");
    breakerRegistry["test7"] = breaker;

    await expect(breaker.execute(alwaysFail)).rejects.toThrow();
    await evaluateAlerts();
    const alerts = getActiveAlerts();
    const circuitAlert = alerts.find((a) => a.id === "circuit-open");
    expect(circuitAlert).toBeDefined();

    delete breakerRegistry["test7"];
  });

  it("Alert resolved when circuit closes", async () => {
    const breaker = new CircuitBreaker("test8", { failureThreshold: 1, successThreshold: 1, resetTimeoutMs: 5 });
    const { breakerRegistry } = await import("../src/resilience/circuitBreaker.js");
    breakerRegistry["test8"] = breaker;

    await expect(breaker.execute(alwaysFail)).rejects.toThrow();
    await evaluateAlerts();
    await new Promise((r) => setTimeout(r, 10));
    // successful execution to close circuit
    await breaker.execute(() => Promise.resolve("ok"));
    await evaluateAlerts();
    const alerts = getActiveAlerts();
    const circuitAlert = alerts.find((a) => a.id === "circuit-open");
    expect(circuitAlert).toBeUndefined();

    delete breakerRegistry["test8"];
  });

  it("Ollama failure triggers fallback", async () => {
    // Simulate Ollama breaker open
    const { ollamaBreaker } = await import("../src/resilience/circuitBreaker.js");
    // Force open state by recording failure beyond threshold
    await expect(ollamaBreaker.execute(alwaysFail)).rejects.toThrow();
    // Subsequent execution should hit fallback
    const result = await fallbackManager.executeFallback("ollama", new Error("offline"));
    expect(result).toHaveProperty("fallbackActive", true);
  });

  it("Browser failure triggers fallback", async () => {
    const { browserBreaker } = await import("../src/resilience/circuitBreaker.js");
    await expect(browserBreaker.execute(alwaysFail)).rejects.toThrow();
    const result = await fallbackManager.executeFallback("browser", new Error("fail"));
    expect(result).toHaveProperty("fallbackActive", true);
  });

  it("API timeout triggers fallback", async () => {
    const { apiBreaker } = await import("../src/resilience/circuitBreaker.js");
    await expect(apiBreaker.execute(alwaysFail)).rejects.toThrow();
    const result = await fallbackManager.executeFallback("api", new Error("timeout"));
    expect(result).toHaveProperty("cached", true);
  });
});
