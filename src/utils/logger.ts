// ════════════════════════════════════════════════════════════════════════════════
// src/utils/logger.ts — Structured, leveled logger with pretty dev output
// ════════════════════════════════════════════════════════════════════════════════

import pino from "pino";
import { env } from "@config/index.js";

// ─── Log Levels ───────────────────────────────────────────────────────────────────
const levelMap: Record<string, number> = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

// ─── Pino Logger Instance ─────────────────────────────────────────────────────────
const pinoOptions: pino.LoggerOptions = {
  level: env.APP_LOG_LEVEL,
  base: {
    app: env.APP_NAME,
    env: env.APP_ENV,
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Pretty-print in dev, structured JSON in prod
  transport:
    env.APP_ENV === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname,app,env",
            messageFormat: "{msg}",
            // Custom colors per level
            customColors: "info:cyan,warn:yellow,error:red,debug:gray",
          },
        }
      : undefined,
};

const baseLogger = pino(pinoOptions);

// ─── Child Logger Factory ─────────────────────────────────────────────────────────
/**
 * Creates a child logger with a module name prefix.
 * Usage: const log = createLogger("memory/db");
 */
export function createLogger(module: string) {
  const child = baseLogger.child({ module });

  return {
    debug: (msg: string, data?: Record<string, unknown>) =>
      child.debug(data ?? {}, `[${module}] ${msg}`),
    info: (msg: string, data?: Record<string, unknown>) =>
      child.info(data ?? {}, `[${module}] ${msg}`),
    warn: (msg: string, data?: Record<string, unknown>) =>
      child.warn(data ?? {}, `[${module}] ${msg}`),
    error: (msg: string, error?: unknown, data?: Record<string, unknown>) => {
      const errData =
        error instanceof Error
          ? { err: { message: error.message, stack: error.stack } }
          : { err: error };
      child.error({ ...errData, ...data }, `[${module}] ${msg}`);
    },
    // LLM-specific: only logs when DEBUG_LLM_CALLS=true
    llm: (msg: string, data?: Record<string, unknown>) => {
      if (env.DEBUG_LLM_CALLS) child.debug(data ?? {}, `[LLM|${module}] ${msg}`);
    },
    // Memory-specific: only logs when DEBUG_MEMORY=true
    mem: (msg: string, data?: Record<string, unknown>) => {
      if (env.DEBUG_MEMORY) child.debug(data ?? {}, `[MEM|${module}] ${msg}`);
    },
    // Tool-specific: only logs when DEBUG_TOOLS=true
    tool: (msg: string, data?: Record<string, unknown>) => {
      if (env.DEBUG_TOOLS) child.debug(data ?? {}, `[TOOL|${module}] ${msg}`);
    },
  };
}

// ─── Root logger (for app-level messages) ─────────────────────────────────────────
export const log = createLogger("creater");

export type Logger = ReturnType<typeof createLogger>;
