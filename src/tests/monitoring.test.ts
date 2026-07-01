// src/tests/monitoring.test.ts
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { systemMetricsTracker, getSystemMetrics, resetSystemMetrics } from "../monitoring/systemMetrics.js";
import { agentMetricsTracker, getAgentMetrics, resetAgentMetrics, recordAgentExecution, recordAgentRetry } from "../monitoring/agentMetrics.js";
import { ollamaMetricsTracker, getOllamaMetrics, resetOllamaMetrics } from "../monitoring/ollamaMetrics.js";
import { metricsRegistry, resetMetrics } from "../monitoring/metrics.js";
import { getHealthStatus, HealthState } from "../monitoring/health.js";
import { alertsManager, evaluateAlerts, getActiveAlerts, clearAlerts, resolveAlert } from "../monitoring/alerts.js";
import { getDashboard } from "../monitoring/dashboard.js";

// Mock checkOllamaHealth
mock.module("../llm/ollama.js", () => {
  return {
    checkOllamaHealth: async () => ({ ok: true, value: ["qwen2.5:3b"] }),
  };
});

describe("Health & Observability Layer Tests", () => {
  beforeEach(() => {
    resetMetrics();
    clearAlerts();
  });

  it("should initialize system metrics with correct default state", () => {
    const sys = getSystemMetrics();
    expect(sys.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(sys.requestCount).toBe(0);
    expect(sys.activeRequests).toBe(0);
    expect(sys.failedRequests).toBe(0);
  });

  it("should record and calculate system request counts and latencies correctly", () => {
    systemMetricsTracker.recordRequestStart();
    systemMetricsTracker.recordRequestStart();
    systemMetricsTracker.recordRequestEnd(100);
    systemMetricsTracker.recordRequestEnd(200);
    systemMetricsTracker.recordRequestFailure();

    const sys = getSystemMetrics();
    expect(sys.requestCount).toBe(2);
    expect(sys.activeRequests).toBe(0);
    expect(sys.failedRequests).toBe(1);
    expect(sys.averageLatencyMs).toBe(150);
    expect(sys.maxLatencyMs).toBe(200);
  });

  it("should record agent execution count, average duration, and failures", () => {
    recordAgentExecution("planner", 150, true);
    recordAgentExecution("planner", 250, false);
    recordAgentRetry("planner");

    const agents = getAgentMetrics();
    expect(agents.planner.executions).toBe(2);
    expect(agents.planner.failures).toBe(1);
    expect(agents.planner.retries).toBe(1);
    expect(agents.planner.avgDurationMs).toBe(200);
  });

  it("should record Ollama metrics correctly", () => {
    ollamaMetricsTracker.recordOperationStart();
    ollamaMetricsTracker.recordQueueWait(50);
    ollamaMetricsTracker.recordMetrics({
      loadMs: 100,
      promptEvalMs: 200,
      evalMs: 300,
      firstTokenMs: 80,
      totalMs: 680,
      tokensProcessed: 30,
    });
    ollamaMetricsTracker.recordOperationEnd();

    const ollama = getOllamaMetrics();
    expect(ollama.load_ms).toBe(100);
    expect(ollama.activeOperations).toBe(0);
    expect(ollama.queueWaitMs).toBe(50);
    expect(ollama.first_token_ms).toBe(80);
    expect(ollama.tokenPerSecond).toBe(100); // 30 tokens in 0.3s
  });

  it("should evaluate and trigger alerts when system state breaches limits", async () => {
    systemMetricsTracker.recordQueueSize(25); // Queue > 20
    const alerts = await evaluateAlerts();
    expect(alerts.length).toBe(1);
    expect(alerts[0].id).toBe("queue-limit");
    expect(alerts[0].level).toBe("warning");
  });

  it("should resolve alerts when system state returns to normal limits", async () => {
    systemMetricsTracker.recordQueueSize(25);
    await evaluateAlerts();
    expect(getActiveAlerts().length).toBe(1);

    systemMetricsTracker.reset(); // queue size reset to 0
    await evaluateAlerts();
    expect(getActiveAlerts().length).toBe(0);
  });

  it("should calculate health score correctly and transition status state", async () => {
    const health = await getHealthStatus();
    expect(health.score).toBe(100);
    expect(health.state).toBe(HealthState.Healthy);
  });

  it("should report degraded health state on minor failures", async () => {
    systemMetricsTracker.recordQueueSize(25); // queue > 20
    // Trigger some latencies > 30000ms
    systemMetricsTracker.recordRequestStart();
    systemMetricsTracker.recordRequestEnd(35000);

    const health = await getHealthStatus();
    expect(health.score).toBeLessThan(100);
  });

  it("should aggregate all values for dashboard retrieval correctly", async () => {
    const db = await getDashboard();
    expect(db.uptime).toBeDefined();
    expect(db.health).toBeDefined();
    expect(db.metrics.system).toBeDefined();
    expect(db.metrics.agents).toBeDefined();
  });

  it("should perform global registry reset correctly", () => {
    systemMetricsTracker.recordRequestStart();
    recordAgentExecution("reasoning", 500, true);
    resetMetrics();

    expect(getSystemMetrics().requestCount).toBe(0);
    expect(getAgentMetrics().reasoning.executions).toBe(0);
  });
});
