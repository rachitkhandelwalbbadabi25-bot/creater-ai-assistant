// ════════════════════════════════════════════════════════════════════════════════
// src/utils/errorHandler.ts — Typed errors, safe wrappers, global handler
// ════════════════════════════════════════════════════════════════════════════════

import { createLogger } from "./logger.js";

const log = createLogger("errorHandler");

// ─── Typed Error Classes ──────────────────────────────────────────────────────────

/** Base class for all Creater-specific errors */
export class CreaterError extends Error {
  public readonly code: string;
  public readonly context?: Record<string, unknown>;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = "CreaterError";
    this.code = code;
    this.context = context;
    Error.captureStackTrace(this, this.constructor);
  }
}

/** LLM / Ollama communication errors */
export class LLMError extends CreaterError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "LLM_ERROR", context);
    this.name = "LLMError";
  }
}

/** Memory read/write/retrieval errors */
export class MemoryError extends CreaterError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "MEMORY_ERROR", context);
    this.name = "MemoryError";
  }
}

/** Tool execution errors (shell, browser, fs, etc.) */
export class ToolError extends CreaterError {
  public readonly toolId: string;

  constructor(toolId: string, message: string, context?: Record<string, unknown>) {
    super(message, "TOOL_ERROR", context);
    this.name = "ToolError";
    this.toolId = toolId;
  }
}

/** Safety check failures — user confirmation denied, dangerous op blocked */
export class SafetyError extends CreaterError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "SAFETY_ERROR", context);
    this.name = "SafetyError";
  }
}

/** Agent graph / orchestration errors */
export class AgentError extends CreaterError {
  public readonly agentName: string;

  constructor(agentName: string, message: string, context?: Record<string, unknown>) {
    super(message, "AGENT_ERROR", context);
    this.name = "AgentError";
    this.agentName = agentName;
  }
}

/** Configuration validation errors */
export class ConfigError extends CreaterError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "CONFIG_ERROR", context);
    this.name = "ConfigError";
  }
}

// ─── Result Type (Railway-Oriented Programming) ───────────────────────────────────
/**
 * A discriminated union for safe error propagation without exceptions.
 * Usage:
 *   const result = await safeAsync(() => fetchData());
 *   if (result.ok) use(result.value);
 *   else handle(result.error);
 */
export type Result<T, E extends Error = CreaterError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E extends Error>(error: E): Result<never, E> {
  return { ok: false, error };
}

// ─── Safe Wrappers ────────────────────────────────────────────────────────────────

/**
 * Wraps a synchronous function in a Result — never throws.
 */
export function safe<T>(fn: () => T): Result<T> {
  try {
    return ok(fn());
  } catch (e) {
    const error = e instanceof CreaterError ? e : new CreaterError(String(e), "UNKNOWN");
    return err(error);
  }
}

/**
 * Wraps an async function in a Result — never throws.
 * Usage: const result = await safeAsync(() => riskyOperation());
 */
export async function safeAsync<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (e) {
    if (e instanceof CreaterError) return err(e);
    const error = new CreaterError(
      e instanceof Error ? e.message : String(e),
      "UNKNOWN",
      e instanceof Error ? { stack: e.stack } : undefined
    );
    return err(error);
  }
}

/**
 * Retry an async operation up to `attempts` times with exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 500
): Promise<T> {
  let lastError: Error = new Error("Retry exhausted");

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (i < attempts - 1) {
        const delay = baseDelayMs * 2 ** i; // exponential backoff
        log.warn(`Retry ${i + 1}/${attempts} failed, retrying in ${delay}ms...`, {
          error: lastError.message,
        });
        await Bun.sleep(delay);
      }
    }
  }

  throw lastError;
}

// ─── Global Unhandled Error Handler ──────────────────────────────────────────────
export function setupGlobalErrorHandler(): void {
  process.on("uncaughtException", (error: Error) => {
    log.error("Uncaught exception — shutting down gracefully", error);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    log.error("Unhandled promise rejection", error);
    // Don't exit — log and continue (Bun handles this gracefully)
  });

  process.on("SIGINT", () => {
    log.info("Received SIGINT — shutting down Creater...");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    log.info("Received SIGTERM — shutting down Creater...");
    process.exit(0);
  });
}

export function formatErrorForUser(error: unknown): string {
  if (error instanceof SafetyError) {
    return `🛑 Safety check failed: ${error.message}. Mujhe permission chahiye iske liye.`;
  }

  const errMsg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  
  // Specific fallbacks for browser launch errors
  if (
    errMsg.includes("browser") || 
    errMsg.includes("chrome") || 
    errMsg.includes("firefox") || 
    errMsg.includes("edge") ||
    errMsg.includes("navigate")
  ) {
    return "Could not launch requested browser.";
  }

  // Specific fallbacks for application or path execution errors
  if (
    errMsg.includes("unable to open") || 
    errMsg.includes("open_app") || 
    errMsg.includes("open_path") || 
    errMsg.includes("launch") || 
    errMsg.includes("executable") ||
    errMsg.includes("spawn")
  ) {
    return "Unable to open requested app.";
  }

  if (error instanceof LLMError) {
    return `🤖 AI se connect nahi ho pa raha. Kya Ollama chal raha hai?`;
  }
  if (error instanceof ToolError) {
    return `Something went wrong while processing the request.`;
  }
  if (error instanceof MemoryError) {
    return `🧠 Memory mein kuch problem aa gayi: ${error.message}`;
  }
  
  return `Something went wrong while processing the request.`;
}
