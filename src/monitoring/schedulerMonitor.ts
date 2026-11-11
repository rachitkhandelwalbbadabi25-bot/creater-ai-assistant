// ════════════════════════════════════════════════════════════════════════════════
// src/monitoring/schedulerMonitor.ts — Background Jobs & Scheduler Telemetry (Phase 7)
// Inspects scheduler health, monitors background jobs, and detects missed runs.
// ════════════════════════════════════════════════════════════════════════════════

import { createLogger } from "@utils/logger.js";
import { type SchedulerHealthMetrics } from "./types.js";
import { listSchedules, isRunning } from "../scheduler/schedulerEngine.js";

const log = createLogger("monitoring/schedulerMonitor");

export function getSchedulerMetrics(): SchedulerHealthMetrics {
  const jobs = listSchedules();
  let activeJobs = 0;
  let pausedJobs = 0;
  let completedJobs = 0;
  let failedJobs = 0;
  let missedOccurrences = 0;

  const now = Date.now();
  const OVERDUE_TOLERANCE_MS = 60000; // 60 seconds overdue threshold

  for (const job of jobs) {
    if (job.status === "ACTIVE") {
      activeJobs++;
      const targetTime = job.schedule?.runAt || job.nextRunAt;
      if (targetTime && targetTime < now - OVERDUE_TOLERANCE_MS) {
        missedOccurrences++;
      }
    } else if (job.status === "PAUSED") {
      pausedJobs++;
    } else if (job.status === "COMPLETED") {
      completedJobs++;
    } else if (job.status === "FAILED") {
      failedJobs++;
    }
  }

  return {
    activeJobs,
    pausedJobs,
    completedJobs,
    failedJobs,
    missedOccurrences,
    loopRunning: isRunning(),
  };
}

export function evaluateSchedulerHealth(): { scoreDeduction: number; issues: string[] } {
  const metrics = getSchedulerMetrics();
  const issues: string[] = [];
  let scoreDeduction = 0;

  if (!metrics.loopRunning && metrics.activeJobs > 0) {
    issues.push(`Scheduler loop is stopped while ${metrics.activeJobs} active job(s) exist`);
    scoreDeduction += 25;
  }

  if (metrics.missedOccurrences > 0) {
    issues.push(`Overdue background schedules detected: ${metrics.missedOccurrences} job(s) missed execution time`);
    scoreDeduction += 15;
  }

  const totalCompletedOrFailed = metrics.completedJobs + metrics.failedJobs;
  if (totalCompletedOrFailed > 0 && metrics.failedJobs / totalCompletedOrFailed > 0.25) {
    issues.push(`High background job failure rate: ${metrics.failedJobs} failed out of ${totalCompletedOrFailed}`);
    scoreDeduction += 15;
  }

  return { scoreDeduction, issues };
}
