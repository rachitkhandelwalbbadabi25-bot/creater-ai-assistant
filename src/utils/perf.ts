import type { Logger } from "./logger.js";

export const IS_RUNTIME_DEBUG = process.env.RUNTIME_DEBUG === "true";

export function nowMs(): number {
  return performance.now();
}

export function logPerf(
  log: Logger,
  label: string,
  startedAt: number,
  data?: Record<string, unknown>,
): void {
  if (!IS_RUNTIME_DEBUG) {
    return;
  }

  log.info(label, {
    durationMs: Number((performance.now() - startedAt).toFixed(2)),
    ...data,
  });
}
