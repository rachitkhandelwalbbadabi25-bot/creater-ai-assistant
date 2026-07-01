// src/monitoring/alerts.ts
import { metricsRegistry } from "./metrics.js";
import { checkOllamaHealth } from "../llm/ollama.js";

export interface Alert {
  id: string;
  level: "info" | "warning" | "critical";
  source: string;
  message: string;
  triggeredAt: number;
  resolvedAt?: number;
  resolved: boolean;
}

import { getResilienceMetrics } from "../resilience/resilienceMetrics.js";

class AlertsManager {
  private alerts: Alert[] = [];
  private ollamaOfflineStart: number | null = null;

  async evaluateAlerts(): Promise<Alert[]> {
    const system = metricsRegistry.getSystemMetrics();
    const api = metricsRegistry.getApiMetrics();
    const resilience = getResilienceMetrics();

    // Check CPU > 90%
    if (system.cpuUsage > 90) {
      this.triggerAlert("cpu-limit", "critical", "System", `CPU usage is high: ${system.cpuUsage}%`);
    } else {
      this.resolveAlert("cpu-limit");
    }

    // Check Memory > 90%
    const memoryPercent = (system.memoryUsage.heapUsed / system.memoryUsage.heapTotal) * 100;
    if (memoryPercent > 90) {
      this.triggerAlert("mem-limit", "critical", "System", `Memory usage is high: ${memoryPercent.toFixed(1)}%`);
    } else {
      this.resolveAlert("mem-limit");
    }

    // Check Queue > 20
    if (system.queueSize > 20) {
      this.triggerAlert("queue-limit", "warning", "Queue", `Queue size is high: ${system.queueSize}`);
    } else {
      this.resolveAlert("queue-limit");
    }

    // Check API failure rate > 20%
    const apiFailureRate = api.totalApiOperations > 0 ? (api.apiFailures / api.totalApiOperations) * 100 : 0;
    if (apiFailureRate > 20) {
      this.triggerAlert("api-failure-limit", "critical", "API", `API failure rate is high: ${apiFailureRate.toFixed(1)}%`);
    } else {
      this.resolveAlert("api-failure-limit");
    }

    // Check Ollama offline
    let ollamaOffline = false;
    try {
      const healthResult = await checkOllamaHealth();
      ollamaOffline = !healthResult.ok;
    } catch {
      ollamaOffline = true;
    }

    if (ollamaOffline) {
      if (this.ollamaOfflineStart === null) {
        this.ollamaOfflineStart = Date.now();
      }
      this.triggerAlert("ollama-offline", "critical", "Ollama", "Ollama runner process/server is offline");

      // Trigger critical if offline > 5 minutes (300000ms)
      if (Date.now() - this.ollamaOfflineStart > 300000) {
        this.triggerAlert("ollama-offline-5m", "critical", "Ollama", "Ollama offline for more than 5 minutes");
      }
    } else {
      this.ollamaOfflineStart = null;
      this.resolveAlert("ollama-offline");
      this.resolveAlert("ollama-offline-5m");
    }

    // Check p95 latency > 30000ms
    if (system.p95LatencyMs > 30000) {
      this.triggerAlert("latency-limit", "warning", "System", `p95 Latency is high: ${system.p95LatencyMs}ms`);
    } else {
      this.resolveAlert("latency-limit");
    }

    // Resilience Checks
    // 1. Circuit Opened
    if (resilience.openCircuits.length > 0) {
      this.triggerAlert("circuit-open", "warning", "Resilience", `Open circuits detected: ${resilience.openCircuits.join(", ")}`);
    } else {
      this.resolveAlert("circuit-open");
    }

    // 2. Recovery failed repeatedly
    if (resilience.failedRecoveries > 3) {
      this.triggerAlert("recovery-failures", "critical", "Resilience", `Recovery has failed repeatedly: ${resilience.failedRecoveries} failures`);
    } else {
      this.resolveAlert("recovery-failures");
    }

    // 3. Fallback executions exceed threshold
    const totalFallbacks = Object.values(resilience.fallbackExecutions).reduce((sum, count) => sum + count, 0);
    if (totalFallbacks > 10) {
      this.triggerAlert("fallback-excessive", "warning", "Resilience", `Excessive fallback executions: ${totalFallbacks} times`);
    } else {
      this.resolveAlert("fallback-excessive");
    }

    return this.alerts;
  }

  private triggerAlert(id: string, level: "info" | "warning" | "critical", source: string, message: string): void {
    const existing = this.alerts.find(a => a.id === id && !a.resolved);
    if (!existing) {
      this.alerts.push({
        id,
        level,
        source,
        message,
        triggeredAt: Date.now(),
        resolved: false,
      });
    }
  }

  resolveAlert(id: string): void {
    const existing = this.alerts.find(a => a.id === id && !a.resolved);
    if (existing) {
      existing.resolved = true;
      existing.resolvedAt = Date.now();
    }
  }

  getActiveAlerts(): Alert[] {
    return this.alerts.filter(a => !a.resolved);
  }

  clearAlerts(): void {
    this.alerts = [];
  }
}

export const alertsManager = new AlertsManager();

export async function evaluateAlerts(): Promise<Alert[]> {
  return await alertsManager.evaluateAlerts();
}

export function getActiveAlerts(): Alert[] {
  return alertsManager.getActiveAlerts();
}

export function resolveAlert(id: string): void {
  alertsManager.resolveAlert(id);
}

export function clearAlerts(): void {
  alertsManager.clearAlerts();
}
