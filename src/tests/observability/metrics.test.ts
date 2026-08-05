// src/tests/observability/metrics.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { recordMetric, incrementCounter, startTimer, getMetrics, clearMetrics, MAX_METRICS, type MetricEvent } from "../../observability/metrics.js";

beforeEach(() => {
  clearMetrics();
});

describe("Metrics collector", () => {
  it("records arbitrary metric events", () => {
    recordMetric({ name: "custom", value: 42, tags: { foo: "bar" } });
    const all = getMetrics();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ name: "custom", value: 42, tags: { foo: "bar" } });
    expect(typeof all[0].timestamp).toBe("number");
  });

  it("increments counters", () => {
    incrementCounter("counter", { source: "test" }, 3);
    incrementCounter("counter", { source: "test" }, 2);
    const all = getMetrics();
    expect(all).toHaveLength(2);
    const total = all.reduce((sum: number, e: MetricEvent) => sum + e.value, 0);
    expect(total).toBe(5);
  });

  it("timer records duration", () => {
    const timer = startTimer("duration", { step: "1" });
    // simulate some work
    const start = Date.now();
    while (Date.now() - start < 5) {}
    timer.end();
    const [event] = getMetrics();
    expect(event.name).toBe("duration");
    expect(event.value).toBeGreaterThanOrEqual(5);
    expect(event.tags).toMatchObject({ step: "1" });
  });

  it("trims oldest metrics when exceeding MAX_METRICS", () => {
    // Record MAX_METRICS + 2 events
    for (let i = 0; i < MAX_METRICS + 2; i++) {
      recordMetric({ name: `m${i}`, value: i });
    }
    const all = getMetrics();
    expect(all).toHaveLength(MAX_METRICS);
    // The first two should have been removed
    expect(all[0].name).toBe("m2");
  });
});
