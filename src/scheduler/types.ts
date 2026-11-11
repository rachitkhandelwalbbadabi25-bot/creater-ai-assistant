// ════════════════════════════════════════════════════════════════════════════════
// src/scheduler/types.ts — Scheduler Domain Models & Interfaces (Phase 6.3)
// ════════════════════════════════════════════════════════════════════════════════

import type { CreateWorkflowParams, Workflow } from "../workflow/types.js";

export type ScheduleType = "ONCE" | "INTERVAL" | "CRON";

export type ScheduleStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELLED";

export type MissedSchedulePolicy = "RUN_ONCE_IF_MISSED" | "SKIP_MISSED";

export interface ScheduleDefinition {
  type: ScheduleType;
  runAt?: number;            // Required for ONCE (timestamp ms)
  intervalMs?: number;       // Required for INTERVAL (ms)
  cronExpression?: string;   // Required for CRON (5-part cron string)
  startTime?: number;        // Optional start boundary timestamp ms
  endTime?: number;          // Optional end boundary timestamp ms
  timezone?: string;         // Explicit timezone (e.g. "UTC", "Asia/Kolkata")
  missedPolicy?: MissedSchedulePolicy; // Policy when schedule was overdue during downtime
}

export interface ScheduledJob {
  id: string;
  name: string;
  description?: string;
  workflowId?: string;                  // Existing workflow ID to execute
  workflowTemplate?: CreateWorkflowParams; // Workflow template definition to create on trigger
  schedule: ScheduleDefinition;
  status: ScheduleStatus;
  nextRunAt?: number;
  lastRunAt?: number;
  executionCount: number;
  failureCount: number;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface CreateScheduleParams {
  id?: string;
  name: string;
  description?: string;
  workflowId?: string;
  workflowTemplate?: CreateWorkflowParams;
  schedule: ScheduleDefinition;
  metadata?: Record<string, unknown>;
}

export interface ScheduledJobExecution {
  jobId: string;
  occurrenceKey: string;
  scheduledTime: number;
  executedTime: number;
  workflowId?: string;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  error?: string;
}

export type SchedulerErrorCode =
  | "VALIDATION_ERROR"
  | "DUPLICATE_CLAIM_ERROR"
  | "JOB_NOT_FOUND"
  | "EXECUTION_ERROR"
  | "INVALID_CRON_ERROR"
  | "UNKNOWN_ERROR";

export class SchedulerError extends Error {
  code: SchedulerErrorCode;
  jobId?: string;
  details?: unknown;

  constructor(message: string, code: SchedulerErrorCode, jobId?: string, details?: unknown) {
    super(message);
    this.name = "SchedulerError";
    this.code = code;
    this.jobId = jobId;
    this.details = details;
  }
}
