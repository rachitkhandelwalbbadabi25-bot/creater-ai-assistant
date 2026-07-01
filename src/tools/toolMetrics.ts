// ════════════════════════════════════════════════════════════════════════════════
// src/tools/toolMetrics.ts — Phase 5.2 + 5.3: Global tool reliability metrics
// ════════════════════════════════════════════════════════════════════════════════

// ─── Phase 5.2 – Browser / Shell / Computer ───────────────────────────────────

export interface ToolMetricsSnapshot {
  // Browser
  browserRetries: number;
  browserFailures: number;
  browserSuccesses: number;
  // Shell
  shellFailures: number;
  shellSuccesses: number;
  // Computer
  computerRetries: number;
  computerFailures: number;
  // Shared
  timeoutCount: number;
  totalOperations: number;
  totalExecutionMs: number;
  successRate: number;           // 0–1
  averageExecutionMs: number;
}

// ─── Phase 5.3 – External API ─────────────────────────────────────────────────

export interface ApiMetricsSnapshot {
  apiRetries: number;
  apiFailures: number;
  apiSuccesses: number;
  rateLimitHits: number;         // HTTP 429
  timeoutCount: number;
  totalApiOperations: number;
  totalApiLatencyMs: number;
  successRate: number;           // 0–1
  averageApiLatency: number;
}

// ─── Internal State ───────────────────────────────────────────────────────────

const metrics = {
  // Browser
  browserRetries: 0,
  browserFailures: 0,
  browserSuccesses: 0,
  // Shell
  shellFailures: 0,
  shellSuccesses: 0,
  // Computer
  computerRetries: 0,
  computerFailures: 0,
  // Shared timeouts
  timeoutCount: 0,
  // Execution totals
  totalOperations: 0,
  totalExecutionMs: 0,
};

const apiMetrics = {
  apiRetries: 0,
  apiFailures: 0,
  apiSuccesses: 0,
  rateLimitHits: 0,
  timeoutCount: 0,
  totalApiOperations: 0,
  totalApiLatencyMs: 0,
};

// ─── Phase 5.2 Recorders ──────────────────────────────────────────────────────

export function recordBrowserRetry(): void    { metrics.browserRetries++; }
export function recordBrowserFailure(): void  { metrics.browserFailures++; metrics.totalOperations++; }
export function recordBrowserSuccess(ms: number): void {
  metrics.browserSuccesses++;
  metrics.totalOperations++;
  metrics.totalExecutionMs += ms;
}

export function recordShellFailure(): void   { metrics.shellFailures++; metrics.totalOperations++; }
export function recordShellSuccess(ms: number): void {
  metrics.shellSuccesses++;
  metrics.totalOperations++;
  metrics.totalExecutionMs += ms;
}

export function recordComputerRetry(): void   { metrics.computerRetries++; }
export function recordComputerFailure(): void { metrics.computerFailures++; metrics.totalOperations++; }
export function recordComputerSuccess(ms: number): void {
  metrics.totalOperations++;
  metrics.totalExecutionMs += ms;
}

export function recordTimeout(): void { metrics.timeoutCount++; }

// ─── Phase 5.3 Recorders ──────────────────────────────────────────────────────

export function recordApiRetry(): void        { apiMetrics.apiRetries++; }
export function recordApiFailure(): void      { apiMetrics.apiFailures++; apiMetrics.totalApiOperations++; }
export function recordApiSuccess(ms: number): void {
  apiMetrics.apiSuccesses++;
  apiMetrics.totalApiOperations++;
  apiMetrics.totalApiLatencyMs += ms;
}
export function recordRateLimitHit(): void    { apiMetrics.rateLimitHits++; }
export function recordApiTimeout(): void      { apiMetrics.timeoutCount++; metrics.timeoutCount++; }

// ─── Getters ──────────────────────────────────────────────────────────────────

export function getToolMetrics(): ToolMetricsSnapshot {
  const totalSuccesses = metrics.browserSuccesses + metrics.shellSuccesses;
  const successRate =
    metrics.totalOperations > 0 ? totalSuccesses / metrics.totalOperations : 1;
  const averageExecutionMs =
    metrics.totalOperations > 0
      ? metrics.totalExecutionMs / metrics.totalOperations
      : 0;

  return {
    ...metrics,
    successRate: Math.round(successRate * 1000) / 1000,
    averageExecutionMs: Math.round(averageExecutionMs),
  };
}

export function getApiMetrics(): ApiMetricsSnapshot {
  const successRate =
    apiMetrics.totalApiOperations > 0
      ? apiMetrics.apiSuccesses / apiMetrics.totalApiOperations
      : 1;
  const averageApiLatency =
    apiMetrics.totalApiOperations > 0
      ? apiMetrics.totalApiLatencyMs / apiMetrics.totalApiOperations
      : 0;

  return {
    ...apiMetrics,
    successRate: Math.round(successRate * 1000) / 1000,
    averageApiLatency: Math.round(averageApiLatency),
  };
}

// ─── Reset (for tests) ────────────────────────────────────────────────────────

export function resetToolMetrics(): void {
  metrics.browserRetries = 0;
  metrics.browserFailures = 0;
  metrics.browserSuccesses = 0;
  metrics.shellFailures = 0;
  metrics.shellSuccesses = 0;
  metrics.computerRetries = 0;
  metrics.computerFailures = 0;
  metrics.timeoutCount = 0;
  metrics.totalOperations = 0;
  metrics.totalExecutionMs = 0;
}

export function resetApiMetrics(): void {
  apiMetrics.apiRetries = 0;
  apiMetrics.apiFailures = 0;
  apiMetrics.apiSuccesses = 0;
  apiMetrics.rateLimitHits = 0;
  apiMetrics.timeoutCount = 0;
  apiMetrics.totalApiOperations = 0;
  apiMetrics.totalApiLatencyMs = 0;
}
