// src/agents/toolExecutor.ts – core executor with retry & backoff

import { createLogger } from "@utils/logger.js";
import { setTimeout as wait } from "timers/promises";

/**
 * Result of a retry‑wrapped execution.
 */
export interface RetryResult {
  success: boolean;
  attempts: number;
  error?: string;
  result?: unknown;
}

/**
 * Configuration for the executor.
 */
export interface ExecutorConfig {
  maxAttempts?: number; // default 3
  baseDelayMs?: number; // default 200
  timeoutMs?: number; // per‑attempt timeout, default 5000ms
}

const defaultConfig: ExecutorConfig = {
  maxAttempts: 3,
  baseDelayMs: 200,
  timeoutMs: 5000,
};

const log = createLogger("agents/toolExecutor");

/**
 * Execute a generic async tool function with retry, exponential back‑off
 * and optional per‑attempt timeout.
 *
 * @param toolFn   The async function to execute. It may be any user‑provided tool.
 * @param args     Arguments to pass to the tool function.
 * @param config   Optional overrides for maxAttempts, baseDelayMs, timeoutMs.
 */
import { breakerRegistry } from "../resilience/circuitBreaker.js";

export async function executeTool<T = unknown>(
  toolFn: (...args: any[]) => Promise<T>,
  argsOrConfig: any[] | ExecutorConfig = [],
  config?: ExecutorConfig
): Promise<RetryResult> {
  const args = Array.isArray(argsOrConfig) ? argsOrConfig : [];
  const activeConfig = !Array.isArray(argsOrConfig) ? argsOrConfig : config;
  const { maxAttempts, baseDelayMs, timeoutMs } = { ...defaultConfig, ...activeConfig };
  let attempt = 0;
  let lastError: any = null;

  // Resolve circuit breaker name from configuration if provided
  const breakerName = (activeConfig as any)?.breakerName;
  const breaker = breakerName ? breakerRegistry[breakerName] : undefined;

  if (breaker && !breaker.canExecute()) {
    return {
      success: false,
      attempts: 0,
      error: `CircuitBreaker '${breakerName}' is OPEN`,
    };
  }

  while (attempt < (maxAttempts ?? 3)) {
    attempt++;
    try {
      log.info(`Attempt ${attempt}/${maxAttempts}`);

      // Apply per‑attempt timeout if configured
      const result = timeoutMs
        ? await Promise.race([
            toolFn(...args),
            wait(timeoutMs).then(() => {
              throw new Error("Tool execution timeout");
            }),
          ])
        : await toolFn(...args);

      log.info(`Tool succeeded on attempt ${attempt}`);
      if (breaker) breaker.recordSuccess();
      return { success: true, attempts: attempt, result };
    } catch (err) {
      lastError = err;
      if (breaker) breaker.recordFailure();
      const classified = classifyError(err);
      log.warn(
        `Tool failed on attempt ${attempt}: ${classified.reason}`,
        { error: err instanceof Error ? err.message : String(err) }
      );

      // If the error is non‑retryable, break early
      if (!classified.retryable) {
        break;
      }

      // Wait before next attempt using exponential back‑off
      const delay = exponentialBackoff(attempt, baseDelayMs ?? 200);
      log.debug(`Waiting ${delay}ms before next retry`);
      await wait(delay);
    }
  }

  // All attempts exhausted or non‑retryable error encountered
  const errorMsg = lastError instanceof Error ? lastError.message : String(lastError);
  log.error(`Tool execution failed after ${attempt} attempts: ${errorMsg}`);
  return { success: false, attempts: attempt, error: errorMsg };
}

/**
 * Simple exponential back‑off calculation.
 * delay = baseDelayMs * 2^(attempt‑1)
 */
export function exponentialBackoff(attempt: number, baseDelayMs: number = 200): number {
  return baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
}

/**
 * Classify an error to decide whether it is retryable.
 * The heuristic is simple: network‑related or temporary errors are retryable.
 */
export function classifyError(err: unknown): { retryable: boolean; reason: string } {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Common transient patterns
    if (msg.includes("timeout") || msg.includes("network") || msg.includes("temporarily")) {
      return { retryable: true, reason: "Transient error" };
    }
    // Explicit aborts are not retryable
    if (msg.includes("abort") || msg.includes("invalid input")) {
      return { retryable: false, reason: "Fatal error" };
    }
  }
  // Fallback – treat unknown errors as retryable but log caution
  return { retryable: true, reason: "Unknown error, assuming retryable" };
}

/**
 * Convenience wrapper that only returns the tool result or throws.
 * Useful for callers that want the raw value and let the executor handle retries.
 */
export async function executeToolOrThrow<T = unknown>(
  toolFn: (...args: any[]) => Promise<T>,
  args: any[] = [],
  config?: ExecutorConfig
): Promise<T> {
  const res = await executeTool(toolFn, args, config);
  if (res.success) {
    return res.result as T;
  }
  throw new Error(res.error ?? "Tool execution failed");
}

// Export types for external consumption
