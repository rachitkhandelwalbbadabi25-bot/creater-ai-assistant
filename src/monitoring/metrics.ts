// src/monitoring/metrics.ts
import { getSystemMetrics, resetSystemMetrics } from "./systemMetrics.js";
import { getAgentMetrics, resetAgentMetrics } from "./agentMetrics.js";
import { getOllamaMetrics, resetOllamaMetrics } from "./ollamaMetrics.js";
import { getToolMetrics, resetToolMetrics, getApiMetrics, resetApiMetrics } from "../tools/toolMetrics.js";
import { getResilienceMetrics, resetResilienceMetrics } from "../resilience/resilienceMetrics.js";

class MetricsRegistry {
  private static instance: MetricsRegistry | null = null;

  private constructor() {}

  static getInstance(): MetricsRegistry {
    if (!MetricsRegistry.instance) {
      MetricsRegistry.instance = new MetricsRegistry();
    }
    return MetricsRegistry.instance;
  }

  getSystemMetrics() {
    return getSystemMetrics();
  }

  getAgentMetrics() {
    return getAgentMetrics();
  }

  getOllamaMetrics() {
    return getOllamaMetrics();
  }

  getToolMetrics() {
    return getToolMetrics();
  }

  getApiMetrics() {
    return getApiMetrics();
  }

  getResilienceMetrics() {
    return getResilienceMetrics();
  }

  getAllMetrics() {
    return {
      system: this.getSystemMetrics(),
      agent: this.getAgentMetrics(),
      ollama: this.getOllamaMetrics(),
      tools: this.getToolMetrics(),
      api: this.getApiMetrics(),
      resilience: this.getResilienceMetrics(),
    };
  }

  resetMetrics(): void {
    resetSystemMetrics();
    resetAgentMetrics();
    resetOllamaMetrics();
    resetToolMetrics();
    resetApiMetrics();
    resetResilienceMetrics();
  }
}

export const metricsRegistry = MetricsRegistry.getInstance();

export function getSystemMetricsFromRegistry() {
  return metricsRegistry.getSystemMetrics();
}

export function resetMetrics(): void {
  metricsRegistry.resetMetrics();
}

export { MetricsRegistry };
