// src/monitoring/types.ts

/**
 * Types used across the monitoring layer.
 */
export interface ToolMetrics {
  browserRetries: number;
  browserFailures: number;
  browserSuccesses: number;
  shellFailures: number;
  shellSuccesses: number;
  computerRetries: number;
  computerFailures: number;
  timeoutCount: number;
  totalOperations: number;
  totalExecutionMs: number;
  successRate: number;
  averageExecutionMs: number;
}

export interface ApiMetrics {
  apiRetries: number;
  apiFailures: number;
  apiSuccesses: number;
  rateLimitHits: number;
  timeoutCount: number;
  totalApiOperations: number;
  totalApiLatencyMs: number;
  successRate: number;
  averageApiLatency: number;
}

export interface OllamaMetrics {
  // aggregated timing values (ms) from Ollama responses
  loadMs?: number;
  promptEvalMs?: number;
  evalMs?: number;
  totalMs?: number;
  // throughput stats
  tokensProcessed?: number;
  activeOperations?: number;
}

export interface SystemMetrics {
  uptimeMs: number;
  memoryUsage: NodeJS.MemoryUsage;
  cpuUsagePercent: number;
  requestCount: number;
  activeRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  queueSize: number;
}

export interface AgentMetrics {
  plannerExecutions: number;
  reasoningExecutions: number;
  memoryExecutions: number;
  verifierExecutions: number;
  composerExecutions: number;
  failures: number;
  retries: number;
  avgDurationMs: number;
}

export interface AllMetrics {
  toolMetrics: ToolMetrics;
  apiMetrics: ApiMetrics;
  ollamaMetrics: OllamaMetrics;
  systemMetrics: SystemMetrics;
  agentMetrics: AgentMetrics;
}

export enum HealthState {
  Healthy = "healthy",
  Degraded = "degraded",
  Unhealthy = "unhealthy",
}

export interface HealthStatus {
  state: HealthState;
  details: string[];
}

export interface Alert {
  id: string;
  metric: string;
  value: number;
  threshold: number;
  severity: "warning" | "critical";
  triggeredAt: number;
  resolvedAt?: number;
}

export interface DashboardPayload {
  health: HealthStatus;
  metrics: AllMetrics;
  alerts: Alert[];
  uptimeMs: number;
}
