// src/intelligence/intelligenceMetrics.ts
/**
 * Intelligence Metrics Module
 * Tracks various counters for the autonomous intelligence layer.
 */

type MetricKey =
  | "experienceCount"
  | "suggestionCount"
  | "autoAppliedCount"
  | "routineExecutions"
  | "proactiveSuggestions"
  | "predictionAccuracy";

const metrics: Record<MetricKey, number> = {
  experienceCount: 0,
  suggestionCount: 0,
  autoAppliedCount: 0,
  routineExecutions: 0,
  proactiveSuggestions: 0,
  predictionAccuracy: 0,
};

/** Increment a specific metric */
export function incMetric(key: MetricKey, delta: number = 1): void {
  if (metrics[key] !== undefined) {
    metrics[key] += delta;
  }
}

/** Set a metric to an exact value (used for accuracy) */
export function setMetric(key: MetricKey, value: number): void {
  if (metrics[key] !== undefined) {
    metrics[key] = value;
  }
}

/** Retrieve a copy of current metrics */
export function getMetrics(): Record<MetricKey, number> {
  // Return a shallow copy to prevent external mutation
  return { ...metrics } as Record<MetricKey, number>;
}

/** Reset all metrics – useful for testing */
export function resetMetrics(): void {
  for (const key in metrics) {
    metrics[key as MetricKey] = 0;
  }
  // also reset our custom state
  automationSavings = 0;
  predictionResults = { correct: 0, total: 0 };
}

/** ----- Automation Savings ----- */
let automationSavings = 0;

export function recordAutomationSavings(amount: number): void {
  automationSavings += amount;
}

export function getAutomationSavings(): number {
  return automationSavings;
}

/** ----- Prediction Results ----- */
let predictionResults = {
  correct: 0,
  total: 0,
};

export function recordPredictionResult(correct: boolean): void {
  predictionResults.total++;
  if (correct) {
    predictionResults.correct++;
  }
}

export function getPredictionResults() {
  return {
    ...predictionResults,
    accuracy:
      predictionResults.total === 0
        ? 0
        : predictionResults.correct / predictionResults.total,
  };
}

/** ----- Telemetry ----- */
export function getIntelligenceTelemetry() {
  const baseMetrics = getMetrics();
  const pred = getPredictionResults();
  return {
    ...baseMetrics,
    automationSavings,
    predictionAccuracy: pred.accuracy * 100,
  };
}

export type { MetricKey };
