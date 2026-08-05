// src/observability/metrics.ts
/**
 * Simple in‑memory metrics collector.
 * All metrics are stored in an array and can be queried via `getMetrics()`.
 * The collector trims the oldest entries once `MAX_METRICS` is exceeded.
 */
export interface MetricEvent {
  /** Name of the metric, e.g. "workflow" or "request_latency" */
  name: string;
  /** Numeric value of the metric */
  value: number;
  /** Optional tags for dimensional analysis */
  tags?: Record<string, string>;
  /** Unix epoch in milliseconds */
  timestamp: number;
}

/** Maximum number of metric events to keep in memory */
export const MAX_METRICS = 10000;

/** Internal storage – kept private to enforce encapsulation */
const metrics: MetricEvent[] = [];

/** Record an arbitrary metric event */
export function recordMetric(event: Omit<MetricEvent, 'timestamp'>): void {
  const full: MetricEvent = { ...event, timestamp: Date.now() };
  metrics.push(full);
  // Trim oldest if we exceed the limit
  if (metrics.length > MAX_METRICS) {
    metrics.splice(0, metrics.length - MAX_METRICS);
  }
}

/** Increment a counter metric – creates or updates a metric with the given name */
export function incrementCounter(
  name: string,
  tags?: Record<string, string>,
  increment = 1
): void {
  recordMetric({ name, value: increment, tags });
}

/** Timer token returned by `startTimer` */
export interface MetricTimer {
  /** End the timer and record the elapsed duration as a metric */
  end(): void;
}

/** Start a timer for a metric. The timer must be ended to record the duration. */
export function startTimer(name: string, tags?: Record<string, string>): MetricTimer {
  const start = Date.now();
  let ended = false;
  return {
    end() {
      if (ended) return;
      const duration = Date.now() - start;
      recordMetric({ name, value: duration, tags });
      ended = true;
    },
  };
}

/** Retrieve a shallow copy of the stored metrics */
export function getMetrics(): MetricEvent[] {
  return metrics.slice();
}

/** Clear all stored metrics (useful for test isolation) */
export function clearMetrics(): void {
  metrics.length = 0;
}
