// ════════════════════════════════════════════════════════════════════════════════
// src/scheduler/cronUtils.ts — Cron Expression Parsing & Schedule Calculations (Phase 6.3)
// ════════════════════════════════════════════════════════════════════════════════

import cron from "node-cron";
import type { ScheduleDefinition } from "./types.js";
import { SchedulerError } from "./types.js";

/**
 * Validates a standard 5-part cron expression using node-cron.
 */
export function validateCronExpression(expression: string): boolean {
  if (!expression || typeof expression !== "string") return false;
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5 && parts.length !== 6) return false;
  return cron.validate(expression);
}

/**
 * Parses a single cron field into a Set of allowed integer values.
 */
export function parseCronField(fieldStr: string, min: number, max: number): Set<number> {
  const result = new Set<number>();
  if (!fieldStr || fieldStr === "*") {
    for (let i = min; i <= max; i++) result.add(i);
    return result;
  }

  const parts = fieldStr.split(",");
  for (const part of parts) {
    if (part.includes("/")) {
      const [rangeStr, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) continue;

      let start = min;
      let end = max;

      if (rangeStr !== "*") {
        if (rangeStr.includes("-")) {
          const [rStart, rEnd] = rangeStr.split("-").map((v) => parseInt(v, 10));
          if (!isNaN(rStart)) start = rStart;
          if (!isNaN(rEnd)) end = rEnd;
        } else {
          const rStart = parseInt(rangeStr, 10);
          if (!isNaN(rStart)) start = rStart;
        }
      }

      for (let i = start; i <= end; i += step) {
        if (i >= min && i <= max) result.add(i);
      }
    } else if (part.includes("-")) {
      const [start, end] = part.split("-").map((v) => parseInt(v, 10));
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = start; i <= end; i++) {
          if (i >= min && i <= max) result.add(i);
        }
      }
    } else {
      const val = parseInt(part, 10);
      if (!isNaN(val) && val >= min && val <= max) {
        result.add(val);
      }
    }
  }

  return result;
}

/**
 * Calculates the next matching timestamp in ms for a 5-part cron expression.
 */
export function getNextCronOccurrence(
  cronExpression: string,
  fromTimeMs: number = Date.now(),
  timezone: string = "UTC"
): number {
  if (!validateCronExpression(cronExpression)) {
    throw new SchedulerError(`Invalid cron expression: '${cronExpression}'`, "INVALID_CRON_ERROR");
  }

  const parts = cronExpression.trim().split(/\s+/);
  const minutes = parseCronField(parts[0], 0, 59);
  const hours = parseCronField(parts[1], 0, 23);
  const doms = parseCronField(parts[2], 1, 31);
  const months = parseCronField(parts[3], 1, 12);
  const dows = parseCronField(parts[4], 0, 6); // 0 = Sunday

  // Start search at the next minute
  const date = new Date(fromTimeMs);
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);

  // Search up to 5 years into the future (limit iterations)
  const maxIterations = 5 * 365 * 24 * 60;
  for (let i = 0; i < maxIterations; i++) {
    const curMonth = date.getUTCMonth() + 1; // 1-12
    const curDom = date.getUTCDate();      // 1-31
    const curDow = date.getUTCDay();       // 0-6
    const curHour = date.getUTCHours();    // 0-23
    const curMin = date.getUTCMinutes();   // 0-59

    if (
      months.has(curMonth) &&
      doms.has(curDom) &&
      dows.has(curDow) &&
      hours.has(curHour) &&
      minutes.has(curMin)
    ) {
      return date.getTime();
    }

    date.setMinutes(date.getMinutes() + 1);
  }

  throw new SchedulerError(`Could not find next occurrence for cron expression: '${cronExpression}'`, "INVALID_CRON_ERROR");
}

/**
 * Deterministically calculates nextRunAt for a ScheduleDefinition based on current time.
 */
export function calculateNextRunAt(
  schedule: ScheduleDefinition,
  fromTimeMs: number = Date.now()
): number | undefined {
  if (!schedule) return undefined;

  const startTime = schedule.startTime || 0;
  const endTime = schedule.endTime || Infinity;
  const effectiveFrom = Math.max(fromTimeMs, startTime);

  if (effectiveFrom >= endTime) {
    return undefined; // Boundary expired
  }

  if (schedule.type === "ONCE") {
    if (!schedule.runAt) {
      throw new SchedulerError("Schedule type ONCE requires 'runAt' timestamp.", "VALIDATION_ERROR");
    }
    if (schedule.runAt > fromTimeMs) {
      return schedule.runAt <= endTime ? schedule.runAt : undefined;
    } else {
      // Overdue/missed schedule: default to RUN_ONCE_IF_MISSED within 24h grace period
      const missedPolicy = schedule.missedPolicy || "RUN_ONCE_IF_MISSED";
      if (missedPolicy === "RUN_ONCE_IF_MISSED") {
        const diffMs = fromTimeMs - schedule.runAt;
        const MAX_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours
        if (diffMs <= MAX_GRACE_PERIOD_MS) {
          return fromTimeMs; // Trigger immediately
        }
        return undefined; // Expired / too stale (> 24 hours overdue) -> do not burst notifications
      }
      return undefined; // SKIP_MISSED -> completed
    }
  }

  if (schedule.type === "INTERVAL") {
    if (!schedule.intervalMs || schedule.intervalMs <= 0) {
      throw new SchedulerError("Schedule type INTERVAL requires positive 'intervalMs'.", "VALIDATION_ERROR");
    }
    let next = Math.max(fromTimeMs + schedule.intervalMs, startTime);
    if (schedule.missedPolicy === "RUN_ONCE_IF_MISSED" && fromTimeMs > startTime && schedule.startTime) {
      next = fromTimeMs;
    }
    return next <= endTime ? next : undefined;
  }

  if (schedule.type === "CRON") {
    if (!schedule.cronExpression) {
      throw new SchedulerError("Schedule type CRON requires 'cronExpression'.", "VALIDATION_ERROR");
    }
    const next = getNextCronOccurrence(schedule.cronExpression, effectiveFrom, schedule.timezone || "UTC");
    return next <= endTime ? next : undefined;
  }

  return undefined;
}
