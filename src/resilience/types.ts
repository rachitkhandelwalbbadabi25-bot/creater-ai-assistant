// src/resilience/types.ts

export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  resetTimeoutMs: number;
}

export interface ResilienceMetrics {
  breakerTrips: Record<string, number>;
  breakerResets: Record<string, number>;
  openCircuits: string[];
  fallbackExecutions: Record<string, number>;
  recoveryExecutions: number;
  successfulRecoveries: number;
  failedRecoveries: number;
}
