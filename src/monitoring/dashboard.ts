// src/monitoring/dashboard.ts
import { getSystemMetrics } from "./systemMetrics.js";
import { getAgentMetrics } from "./agentMetrics.js";
import { getOllamaMetrics } from "./ollamaMetrics.js";
import { getToolMetrics, getApiMetrics } from "../tools/toolMetrics.js";
import { getHealthStatus } from "./health.js";
import { getActiveAlerts } from "./alerts.js";

import { getResilienceMetrics } from "../resilience/resilienceMetrics.js";
import { getIntelligenceTelemetry } from "../intelligence/intelligenceMetrics.js";

export async function getDashboard() {
  const system = getSystemMetrics();
  const agents = getAgentMetrics();
  const ollama = getOllamaMetrics();
  const tools = getToolMetrics();
  const api = getApiMetrics();
  const health = await getHealthStatus();
  const alerts = getActiveAlerts();
  const resilience = getResilienceMetrics();
  const intelligence = getIntelligenceTelemetry();

  return {
    uptime: system.uptimeMs,
    health,
    alerts,
    metrics: {
      system,
      agents,
      ollama,
      tools,
      api,
      resilience,
      intelligence,
      memory: system.memoryUsage,
    },
  };
}

