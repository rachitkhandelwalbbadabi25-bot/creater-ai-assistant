// src/monitoring/agentMetrics.ts
import { AgentMetrics } from "./types.js";

export interface SingleAgentMetrics {
  executions: number;
  failures: number;
  retries: number;
  avgDurationMs: number;
  totalDurationMs: number;
}

class AgentMetricsTracker {
  private agentMetricsMap = new Map<string, SingleAgentMetrics>();

  private getOrCreateAgent(agentName: string): SingleAgentMetrics {
    if (!this.agentMetricsMap.has(agentName)) {
      this.agentMetricsMap.set(agentName, {
        executions: 0,
        failures: 0,
        retries: 0,
        avgDurationMs: 0,
        totalDurationMs: 0,
      });
    }
    return this.agentMetricsMap.get(agentName)!;
  }

  recordExecution(agentName: string, durationMs: number, success: boolean): void {
    const metrics = this.getOrCreateAgent(agentName);
    metrics.executions++;
    metrics.totalDurationMs += durationMs;
    metrics.avgDurationMs = metrics.totalDurationMs / metrics.executions;
    if (!success) {
      metrics.failures++;
    }
  }

  recordRetry(agentName: string): void {
    const metrics = this.getOrCreateAgent(agentName);
    metrics.retries++;
  }

  reset(): void {
    this.agentMetricsMap.clear();
  }

  getAgentMetrics(agentName: string): SingleAgentMetrics {
    return { ...this.getOrCreateAgent(agentName) };
  }

  getAllAgentMetrics(): Record<string, SingleAgentMetrics> {
    const result: Record<string, SingleAgentMetrics> = {};
    const agents = ["planner", "reasoning", "memory", "verifier", "composer"];
    for (const agent of agents) {
      result[agent] = this.getAgentMetrics(agent);
    }
    return result;
  }
}

export const agentMetricsTracker = new AgentMetricsTracker();

export function recordAgentExecution(agentName: string, durationMs: number, success: boolean): void {
  agentMetricsTracker.recordExecution(agentName, durationMs, success);
}

export function recordAgentRetry(agentName: string): void {
  agentMetricsTracker.recordRetry(agentName);
}

export function getAgentMetrics() {
  return agentMetricsTracker.getAllAgentMetrics();
}

export function resetAgentMetrics(): void {
  agentMetricsTracker.reset();
}
