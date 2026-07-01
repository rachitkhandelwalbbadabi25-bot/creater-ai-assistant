// src/resilience/circuitBreaker.ts
import { CircuitState, CircuitBreakerConfig } from "./types.js";
import { resilienceMetricsTracker } from "./resilienceMetrics.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("resilience/circuitBreaker");

export class CircuitBreaker {
  private state = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;

  constructor(
    public readonly name: string,
    private config: CircuitBreakerConfig = { failureThreshold: 5, successThreshold: 2, resetTimeoutMs: 15000 }
  ) {}

  getState(): CircuitState {
    this.evaluateState();
    return this.state;
  }

  private evaluateState(): void {
    if (this.state === CircuitState.OPEN) {
      const now = Date.now();
      if (now - this.lastFailureTime > this.config.resetTimeoutMs) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        this.failureCount = 0;
        log.info(`Breaker '${this.name}' transitioned to HALF_OPEN (timeout elapsed)`);
      }
    }
  }

  canExecute(): boolean {
    this.evaluateState();
    return this.state !== CircuitState.OPEN;
  }

  recordSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        resilienceMetricsTracker.recordReset(this.name);
        log.info(`Breaker '${this.name}' transitioned to CLOSED (success threshold met)`);
      }
    } else if (this.state === CircuitState.CLOSED) {
      this.failureCount = 0;
    }
  }

  recordFailure(): void {
    this.lastFailureTime = Date.now();
    this.failureCount++;

    if (this.state === CircuitState.CLOSED) {
      if (this.failureCount >= this.config.failureThreshold) {
        this.state = CircuitState.OPEN;
        resilienceMetricsTracker.recordTrip(this.name);
        log.warn(`Breaker '${this.name}' tripped to OPEN (failure threshold met)`);
      }
    } else if (this.state === CircuitState.HALF_OPEN) {
      this.state = CircuitState.OPEN;
      resilienceMetricsTracker.recordTrip(this.name);
      log.warn(`Breaker '${this.name}' tripped back to OPEN from HALF_OPEN`);
    }
  }

  reset(): void {
    const wasOpen = this.state === CircuitState.OPEN || this.state === CircuitState.HALF_OPEN;
    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
    if (wasOpen) {
      resilienceMetricsTracker.recordReset(this.name);
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new Error(`CircuitBreaker '${this.name}' is OPEN`);
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }
}

// Breaker Registry
export const browserBreaker = new CircuitBreaker("browser", { failureThreshold: 3, successThreshold: 2, resetTimeoutMs: 10000 });
export const ollamaBreaker = new CircuitBreaker("ollama", { failureThreshold: 3, successThreshold: 2, resetTimeoutMs: 15000 });
export const apiBreaker = new CircuitBreaker("api", { failureThreshold: 5, successThreshold: 2, resetTimeoutMs: 10000 });
export const fileSystemBreaker = new CircuitBreaker("fileSystem", { failureThreshold: 10, successThreshold: 1, resetTimeoutMs: 5000 });
export const shellBreaker = new CircuitBreaker("shell", { failureThreshold: 5, successThreshold: 2, resetTimeoutMs: 10000 });
export const embeddingBreaker = new CircuitBreaker("embedding", { failureThreshold: 3, successThreshold: 2, resetTimeoutMs: 15000 });

export const breakerRegistry: Record<string, CircuitBreaker> = {
  browser: browserBreaker,
  ollama: ollamaBreaker,
  api: apiBreaker,
  fileSystem: fileSystemBreaker,
  shell: shellBreaker,
  embedding: embeddingBreaker,
};
