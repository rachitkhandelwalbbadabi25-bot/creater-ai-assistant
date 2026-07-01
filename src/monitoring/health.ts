// src/monitoring/health.ts
import { checkOllamaHealth } from "../llm/ollama.js";
import { metricsRegistry } from "./metrics.js";

export enum HealthState {
  Healthy = "healthy",
  Degraded = "degraded",
  Unhealthy = "unhealthy",
}

export interface HealthStatus {
  state: HealthState;
  details: string[];
  score: number;
  timestamp: number;
}

export async function getHealthStatus(): Promise<HealthStatus> {
  const details: string[] = [];
  let score = 100;

  // 1. Ollama availability
  try {
    const healthResult = await checkOllamaHealth();
    if (!healthResult.ok) {
      details.push("Ollama offline: Health check failed");
      score -= 30;
    }
  } catch (error) {
    details.push("Ollama offline: Connection error");
    score -= 30;
  }

  const systemMetrics = metricsRegistry.getSystemMetrics();
  const apiMetrics = metricsRegistry.getApiMetrics();

  // 2. API failure rate
  // If api failure rate > 20%
  const apiFailureRate = apiMetrics.totalApiOperations > 0 
    ? (apiMetrics.apiFailures / apiMetrics.totalApiOperations) 
    : 0;
  if (apiFailureRate > 0.20) {
    details.push(`High API failure rate: ${(apiFailureRate * 100).toFixed(1)}%`);
    score -= 20;
  }

  // 3. Queue saturation
  // Let's check system queueSize. If > 20:
  if (systemMetrics.queueSize > 20) {
    details.push(`Queue saturation: Queue size is ${systemMetrics.queueSize}`);
    score -= 15;
  }

  // 4. High latency
  // If average or p95 latency > 30000ms (30s)
  if (systemMetrics.p95LatencyMs > 30000) {
    details.push(`High latency: p95 latency is ${systemMetrics.p95LatencyMs}ms`);
    score -= 15;
  }

  // 5. Memory pressure
  // If memory usage > 90% (Using rss / total memory or heapUsed / heapLimit)
  const memory = systemMetrics.memoryUsage;
  const memoryLimit = memory.heapTotal; // Simple check or process memory limit
  const memoryPercent = memory.heapUsed / memory.heapTotal;
  if (memoryPercent > 0.90) {
    details.push(`Memory pressure: Heap usage is ${(memoryPercent * 100).toFixed(1)}%`);
    score -= 20;
  }

  // Cap score to min of 0
  score = Math.max(0, score);

  let state = HealthState.Healthy;
  if (score < 50) {
    state = HealthState.Unhealthy;
  } else if (score < 80) {
    state = HealthState.Degraded;
  }

  return {
    state,
    details,
    score,
    timestamp: Date.now(),
  };
}
