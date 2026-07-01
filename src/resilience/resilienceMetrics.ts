// src/resilience/resilienceMetrics.ts
import { ResilienceMetrics } from "./types.js";

class ResilienceMetricsTracker {
  private trips: Record<string, number> = {};
  private resets: Record<string, number> = {};
  private fallbacks: Record<string, number> = {};
  private openBreakers = new Set<string>();
  private recoveries = 0;
  private successRecoveries = 0;
  private failRecoveries = 0;

  recordTrip(name: string): void {
    this.trips[name] = (this.trips[name] || 0) + 1;
    this.openBreakers.add(name);
  }

  recordReset(name: string): void {
    this.resets[name] = (this.resets[name] || 0) + 1;
    this.openBreakers.delete(name);
  }

  recordFallback(name: string): void {
    this.fallbacks[name] = (this.fallbacks[name] || 0) + 1;
  }

  recordRecoveryAttempt(): void {
    this.recoveries++;
  }

  recordRecoverySuccess(): void {
    this.successRecoveries++;
  }

  recordRecoveryFailure(): void {
    this.failRecoveries++;
  }

  getSnapshot(): ResilienceMetrics {
    return {
      breakerTrips: { ...this.trips },
      breakerResets: { ...this.resets },
      openCircuits: Array.from(this.openBreakers),
      fallbackExecutions: { ...this.fallbacks },
      recoveryExecutions: this.recoveries,
      successfulRecoveries: this.successRecoveries,
      failedRecoveries: this.failRecoveries,
    };
  }

  reset(): void {
    this.trips = {};
    this.resets = {};
    this.fallbacks = {};
    this.openBreakers.clear();
    this.recoveries = 0;
    this.successRecoveries = 0;
    this.failRecoveries = 0;
  }
}

export const resilienceMetricsTracker = new ResilienceMetricsTracker();

export function getResilienceMetrics(): ResilienceMetrics {
  return resilienceMetricsTracker.getSnapshot();
}

export function resetResilienceMetrics(): void {
  resilienceMetricsTracker.reset();
}
