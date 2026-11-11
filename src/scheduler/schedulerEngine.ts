// ════════════════════════════════════════════════════════════════════════════════
// src/scheduler/schedulerEngine.ts — Scheduler / Cron Engine Foundation (Phase 6.3)
// Deterministic, persistent, observable, and restart-safe scheduling layer.
// ════════════════════════════════════════════════════════════════════════════════

import { createLogger } from "@utils/logger.js";
import { recordMetric, incrementCounter } from "../monitoring/metrics.js";
import { createTask, updateTask, getTask, listTasks, deleteTask } from "../orchestrator/stateStore.js";
import {
  createWorkflow,
  startWorkflow,
  executeAllSteps,
  getWorkflow,
  resumeWaitingWorkflows,
} from "../workflow/workflowEngine.js";
import type {
  ScheduledJob,
  CreateScheduleParams,
  ScheduleStatus,
  ScheduledJobExecution,
} from "./types.js";
import { SchedulerError } from "./types.js";
import { validateCronExpression, calculateNextRunAt } from "./cronUtils.js";
import { getDB } from "../memory/db.js";

const log = createLogger("scheduler/engine");

/** Sensitive parameter key pattern for secret sanitization */
const SENSITIVE_KEY_REGEX = /(password|secret|token|apikey|api_key|auth_header|authorization|private_key|credential)/i;

/** Persists a ScheduledJob directly to the SQLite schedules table */
export function persistScheduleToDb(job: ScheduledJob): void {
  try {
    const db = getDB();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO schedules (
        id, name, description, workflow_id, workflow_template,
        schedule_type, run_at, interval_ms, cron_expression, timezone,
        missed_policy, status, next_run_at, last_run_at, execution_count,
        failure_count, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      job.id,
      job.name,
      job.description || null,
      job.workflowId || null,
      job.workflowTemplate ? JSON.stringify(job.workflowTemplate) : null,
      job.schedule.type,
      job.schedule.runAt || null,
      job.schedule.intervalMs || null,
      job.schedule.cronExpression || null,
      job.schedule.timezone || null,
      job.schedule.missedPolicy || "RUN_ONCE_IF_MISSED",
      job.status,
      job.nextRunAt || null,
      job.lastRunAt || null,
      job.executionCount,
      job.failureCount,
      JSON.stringify(job.metadata || {}),
      job.createdAt,
      job.updatedAt
    );
  } catch (err: any) {
    log.warn(`Failed to persist schedule [${job.id}] to SQLite:`, err.message);
  }
}

/** Deletes a ScheduledJob from SQLite schedules and occurrences */
export function deleteScheduleFromDb(jobId: string): void {
  try {
    const db = getDB();
    db.prepare("DELETE FROM schedules WHERE id = ?").run(jobId);
    db.prepare("DELETE FROM schedule_occurrences WHERE schedule_id = ?").run(jobId);
  } catch (err: any) {
    log.warn(`Failed to delete schedule [${jobId}] from SQLite:`, err.message);
  }
}

/** Atomically records an occurrence claim in SQLite to guarantee duplicate execution protection */
export function recordOccurrenceClaimInDb(jobId: string, occurrenceKey: string, scheduledTime: number): boolean {
  try {
    const db = getDB();
    const existing = db.prepare("SELECT status FROM schedule_occurrences WHERE occurrence_key = ?").get(occurrenceKey) as any;
    if (existing) {
      if (existing.status === "CLAIMED" || existing.status === "SUCCESS") {
        return false;
      }
    }
    const id = `occ_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();
    const res = db.prepare(`
      INSERT OR IGNORE INTO schedule_occurrences (
        id, schedule_id, occurrence_key, scheduled_time, executed_time, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'CLAIMED', ?)
    `).run(id, jobId, occurrenceKey, scheduledTime, now, now);

    return res.changes > 0 || !existing;
  } catch (err: any) {
    log.warn(`Failed to record occurrence claim in SQLite:`, err.message);
    return true; // Fallback to in-memory lock
  }
}

/** Updates occurrence status and delivery outcomes persistently in SQLite */
export function recordOccurrenceOutcomeInDb(
  occurrenceKey: string,
  status: "SUCCESS" | "FAILED" | "SKIPPED",
  error?: string,
  details?: { channel?: string; title?: string; body?: string }
): void {
  try {
    const db = getDB();
    const now = Date.now();
    db.prepare(`
      UPDATE schedule_occurrences
      SET status = ?, executed_time = ?, delivered_channel = ?, notification_title = ?, notification_body = ?, error = ?
      WHERE occurrence_key = ?
    `).run(
      status,
      now,
      details?.channel || "desktop_toast",
      details?.title || null,
      details?.body || null,
      error || null,
      occurrenceKey
    );
  } catch (err: any) {
    log.warn(`Failed to update occurrence outcome in SQLite:`, err.message);
  }
}

/** Queries recorded occurrences from SQLite (for verification and tests) */
export function getDbOccurrences(scheduleId?: string): any[] {
  try {
    const db = getDB();
    if (scheduleId) {
      return db.prepare("SELECT * FROM schedule_occurrences WHERE schedule_id = ?").all(scheduleId);
    }
    return db.prepare("SELECT * FROM schedule_occurrences").all();
  } catch (err: any) {
    return [];
  }
}

/** Queries persisted schedules from SQLite (for verification and tests) */
export function getDbSchedules(): any[] {
  try {
    const db = getDB();
    return db.prepare("SELECT * FROM schedules").all();
  } catch (err: any) {
    return [];
  }
}

/** Synchronizes persisted active schedules and occurrences from SQLite into in-memory store */
export function syncFromDb(): void {
  try {
    const db = getDB();
    // 1. Restore claimed occurrences so restart never duplicates already processed occurrences
    const occRows = db.prepare("SELECT occurrence_key FROM schedule_occurrences WHERE status IN ('CLAIMED', 'SUCCESS')").all() as any[];
    for (const row of occRows) {
      if (row.occurrence_key) claimedOccurrences.add(row.occurrence_key);
    }

    // 2. Restore active schedules from SQLite into stateStore if missing or update if modified
    const schedRows = db.prepare("SELECT * FROM schedules WHERE status = 'ACTIVE'").all() as any[];
    for (const row of schedRows) {
      const existingTask = getTask(`job_${row.id}`);
      if (!existingTask) {
        let wfTemplate: any;
        try { if (row.workflow_template) wfTemplate = JSON.parse(row.workflow_template); } catch {}
        let meta: any;
        try { if (row.metadata) meta = JSON.parse(row.metadata); } catch {}

        const job: ScheduledJob = {
          id: row.id,
          name: row.name,
          description: row.description || undefined,
          workflowId: row.workflow_id || undefined,
          workflowTemplate: wfTemplate,
          schedule: {
            type: row.schedule_type,
            runAt: row.run_at || undefined,
            intervalMs: row.interval_ms || undefined,
            cronExpression: row.cron_expression || undefined,
            timezone: row.timezone || undefined,
            missedPolicy: row.missed_policy || "RUN_ONCE_IF_MISSED",
          },
          status: row.status as ScheduleStatus,
          nextRunAt: row.next_run_at || undefined,
          lastRunAt: row.last_run_at || undefined,
          executionCount: row.execution_count || 0,
          failureCount: row.failure_count || 0,
          createdAt: row.created_at || Date.now(),
          updatedAt: row.updated_at || Date.now(),
          metadata: meta || {},
        };

        createTask(`job_${job.id}`, mapJobToTaskState(job));
      } else if (existingTask.metadata?.status === "ACTIVE") {
        updateTask(`job_${row.id}`, (prev: any) => ({
          ...prev,
          status: row.status.toLowerCase(),
          metadata: {
            ...prev.metadata,
            status: row.status,
            nextRunAt: row.next_run_at || undefined,
          },
        }));
      }
    }

    // 3. Mark inactive schedules as completed/cancelled in stateStore
    const nonActiveRows = db.prepare("SELECT id, status FROM schedules WHERE status != 'ACTIVE'").all() as any[];
    for (const row of nonActiveRows) {
      const existingTask = getTask(`job_${row.id}`);
      if (existingTask && existingTask.metadata?.status === "ACTIVE") {
        updateTask(`job_${row.id}`, (prev: any) => ({
          ...prev,
          status: row.status.toLowerCase() as any,
          metadata: {
            ...prev.metadata,
            status: row.status,
          },
        }));
      }
    }
  } catch (err: any) {
    log.warn("Could not sync schedules from SQLite DB:", err.message);
  }
}

/** Recursively sanitizes sensitive parameters before persisting to stateStore */
function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_KEY_REGEX.test(k)) {
        sanitized[k] = "[REDACTED_SECRET]";
      } else {
        sanitized[k] = sanitizeValue(v);
      }
    }
    return sanitized;
  }
  return value;
}

/** In-memory registry of claimed occurrence keys to prevent duplicate execution */
const claimedOccurrences = new Set<string>();

/** Active background timer handle */
let pollTimer: NodeJS.Timeout | null = null;
let isPolling = false;

/** Maps TaskState from stateStore to ScheduledJob domain model */
function mapTaskStateToJob(taskState: any): ScheduledJob {
  if (!taskState || typeof taskState !== "object") {
    throw new SchedulerError("Corrupted schedule state", "VALIDATION_ERROR");
  }
  const meta = taskState.metadata || {};
  return {
    id: meta.jobId || taskState.taskId.replace(/^job_/, ""),
    name: meta.name || "Unnamed Job",
    description: meta.description,
    workflowId: meta.workflowId,
    workflowTemplate: meta.workflowTemplate,
    schedule: meta.schedule || { type: "ONCE" },
    status: (meta.status || "ACTIVE").toUpperCase() as ScheduleStatus,
    nextRunAt: meta.nextRunAt,
    lastRunAt: meta.lastRunAt,
    executionCount: typeof meta.executionCount === "number" ? meta.executionCount : 0,
    failureCount: typeof meta.failureCount === "number" ? meta.failureCount : 0,
    createdAt: new Date(taskState.createdAt).getTime(),
    updatedAt: new Date(taskState.updatedAt).getTime(),
    metadata: meta.customMetadata || {},
  };
}

/** Maps ScheduledJob domain model to TaskState for stateStore persistence */
function mapJobToTaskState(job: ScheduledJob): any {
  const sanitizedJob = sanitizeValue(job) as ScheduledJob;

  return {
    taskId: `job_${job.id}`,
    status: job.status.toLowerCase(),
    steps: [],
    outputs: [],
    artifacts: [],
    errors: [],
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
    metadata: {
      taskType: "scheduled_job",
      jobId: job.id,
      name: job.name,
      description: job.description,
      workflowId: job.workflowId,
      workflowTemplate: sanitizedJob.workflowTemplate,
      schedule: job.schedule,
      status: job.status,
      nextRunAt: job.nextRunAt,
      lastRunAt: job.lastRunAt,
      executionCount: job.executionCount,
      failureCount: job.failureCount,
      customMetadata: sanitizedJob.metadata,
      claimedOccurrences: Array.from(claimedOccurrences).filter((k) => k.startsWith(`${job.id}:`)),
    },
  };
}

// ─── Core Scheduler CRUD & Lifecycle Operations ────────────────────────────────

/**
 * Creates and persists a new ScheduledJob.
 */
export function createSchedule(params: CreateScheduleParams): ScheduledJob {
  if (!params || !params.name || typeof params.name !== "string" || params.name.trim() === "") {
    throw new SchedulerError("Schedule creation failed: missing or invalid name.", "VALIDATION_ERROR");
  }

  if (!params.schedule || !params.schedule.type) {
    throw new SchedulerError("Schedule creation failed: missing schedule definition.", "VALIDATION_ERROR");
  }

  const { type, cronExpression, runAt, intervalMs } = params.schedule;

  if (type === "CRON") {
    if (!cronExpression || !validateCronExpression(cronExpression)) {
      throw new SchedulerError(`Invalid cron expression: '${cronExpression}'`, "INVALID_CRON_ERROR");
    }
  } else if (type === "ONCE") {
    if (!runAt || typeof runAt !== "number" || isNaN(runAt)) {
      throw new SchedulerError("Schedule type ONCE requires a valid 'runAt' timestamp.", "VALIDATION_ERROR");
    }
  } else if (type === "INTERVAL") {
    if (!intervalMs || typeof intervalMs !== "number" || intervalMs <= 0) {
      throw new SchedulerError("Schedule type INTERVAL requires a positive 'intervalMs'.", "VALIDATION_ERROR");
    }
  } else {
    throw new SchedulerError(`Unsupported schedule type: '${type}'`, "VALIDATION_ERROR");
  }

  if (!params.workflowId && !params.workflowTemplate) {
    throw new SchedulerError("Schedule creation failed: must specify either 'workflowId' or 'workflowTemplate'.", "VALIDATION_ERROR");
  }

  const jobId = params.id || `sched_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();
  const initialNextRun = calculateNextRunAt(params.schedule, now);

  const job: ScheduledJob = {
    id: jobId,
    name: params.name,
    description: params.description,
    workflowId: params.workflowId,
    workflowTemplate: params.workflowTemplate,
    schedule: params.schedule,
    status: "ACTIVE",
    nextRunAt: initialNextRun,
    executionCount: 0,
    failureCount: 0,
    createdAt: now,
    updatedAt: now,
    metadata: params.metadata || {},
  };

  createTask(`job_${jobId}`, mapJobToTaskState(job));
  persistScheduleToDb(job);
  log.info(`ScheduledJob created: [${job.id}] "${job.name}" (${job.schedule.type}, nextRunAt: ${job.nextRunAt ? new Date(job.nextRunAt).toISOString() : "none"})`);
  incrementCounter("scheduler.created");

  // Ensure the background scheduler loop is actively ticking
  if (!isPolling && !pollTimer) {
    start(1000);
  }

  return job;
}

/**
 * Retrieves a scheduled job by ID.
 */
export function getSchedule(jobId: string): ScheduledJob | undefined {
  const task = getTask(`job_${jobId}`) || getTask(jobId);
  return task ? mapTaskStateToJob(task) : undefined;
}

/**
 * Lists all registered scheduled jobs.
 */
export function listSchedules(): ScheduledJob[] {
  syncFromDb();
  const result: ScheduledJob[] = [];
  for (const taskState of listTasks()) {
    if (taskState.metadata?.taskType === "scheduled_job") {
      try {
        result.push(mapTaskStateToJob(taskState));
      } catch (err: any) {
        log.warn(`Skipped malformed scheduled job [${taskState.taskId}]: ${err.message}`);
      }
    }
  }
  return result;
}

/**
 * Pauses an ACTIVE schedule.
 */
export function pauseSchedule(jobId: string): ScheduledJob {
  const job = getSchedule(jobId);
  if (!job) {
    throw new SchedulerError(`Schedule [${jobId}] not found.`, "JOB_NOT_FOUND", jobId);
  }

  job.status = "PAUSED";
  job.updatedAt = Date.now();
  updateTask(`job_${job.id}`, () => mapJobToTaskState(job));
  persistScheduleToDb(job);

  log.info(`Schedule paused: [${job.id}] "${job.name}"`);
  incrementCounter("scheduler.job.paused");
  return job;
}

/**
 * Resumes a PAUSED schedule back to ACTIVE status.
 */
export function resumeSchedule(jobId: string): ScheduledJob {
  const job = getSchedule(jobId);
  if (!job) {
    throw new SchedulerError(`Schedule [${jobId}] not found.`, "JOB_NOT_FOUND", jobId);
  }

  job.status = "ACTIVE";
  job.nextRunAt = calculateNextRunAt(job.schedule, Date.now());
  job.updatedAt = Date.now();
  updateTask(`job_${job.id}`, () => mapJobToTaskState(job));
  persistScheduleToDb(job);

  log.info(`Schedule resumed: [${job.id}] "${job.name}" (nextRunAt: ${job.nextRunAt ? new Date(job.nextRunAt).toISOString() : "none"})`);
  incrementCounter("scheduler.job.resumed");
  return job;
}

/**
 * Cancels a schedule permanently.
 */
export function cancelSchedule(jobId: string): ScheduledJob {
  const job = getSchedule(jobId);
  if (!job) {
    throw new SchedulerError(`Schedule [${jobId}] not found.`, "JOB_NOT_FOUND", jobId);
  }

  job.status = "CANCELLED";
  job.nextRunAt = undefined;
  job.updatedAt = Date.now();
  updateTask(`job_${job.id}`, () => mapJobToTaskState(job));
  persistScheduleToDb(job);

  log.info(`Schedule cancelled: [${job.id}] "${job.name}"`);
  incrementCounter("scheduler.job.cancelled");
  return job;
}

/**
 * Deletes a schedule from the store.
 */
export function deleteSchedule(jobId: string): void {
  deleteTask(`job_${jobId}`);
  deleteTask(jobId);
  deleteScheduleFromDb(jobId);
  log.info(`Deleted schedule [${jobId}]`);
}

/**
 * Returns all ACTIVE scheduled jobs due for execution at or before fromTimeMs.
 */
export function getDueSchedules(fromTimeMs: number = Date.now()): ScheduledJob[] {
  syncFromDb();
  return listSchedules().filter(
    (job) => job.status === "ACTIVE" && job.nextRunAt !== undefined && job.nextRunAt <= fromTimeMs
  );
}

// ─── Occurrence Claiming & Duplicate Execution Protection ──────────────────────

/**
 * Claims a single occurrence execution attempt to prevent duplicate execution.
 */
export function claimOccurrence(jobId: string, occurrenceKey: string, scheduledTime: number = Date.now()): boolean {
  if (claimedOccurrences.has(occurrenceKey)) {
    return false; // Already claimed in-memory!
  }
  const dbClaimed = recordOccurrenceClaimInDb(jobId, occurrenceKey, scheduledTime);
  if (!dbClaimed) {
    return false; // Already claimed or succeeded in SQLite DB!
  }
  claimedOccurrences.add(occurrenceKey);
  incrementCounter("scheduler.job.claimed");
  return true;
}

/**
 * Clears claimed occurrences (used during engine resets or unit testing).
 */
export function clearClaimedOccurrences(): void {
  claimedOccurrences.clear();
}

// ─── Scheduler → Workflow Engine Trigger Integration ───────────────────────────

/**
 * Triggers a scheduled job occurrence through the existing Workflow Engine pipeline.
 */
export async function executeScheduledJob(
  job: ScheduledJob,
  scheduledTime: number = Date.now()
): Promise<ScheduledJobExecution> {
  const occurrenceKey = `${job.id}:${scheduledTime}`;

  if (!claimOccurrence(job.id, occurrenceKey, scheduledTime)) {
    log.warn(`Duplicate execution blocked for job [${job.id}] occurrence [${occurrenceKey}]`);
    return {
      jobId: job.id,
      occurrenceKey,
      scheduledTime,
      executedTime: Date.now(),
      status: "SKIPPED",
      error: "Duplicate execution prevented by occurrence claim lock",
    };
  }

  log.info(`Triggering workflow execution for schedule [${job.id}] "${job.name}"...`);
  incrementCounter("scheduler.execution.started");

  let targetWorkflowId = job.workflowId;

  try {
    // Instantiate template if workflowId not directly specified
    if (job.workflowTemplate) {
      const createdWf = createWorkflow({
        ...job.workflowTemplate,
        name: `${job.name} (Scheduled Run)`,
        metadata: {
          ...(job.workflowTemplate.metadata || {}),
          scheduledJobId: job.id,
          occurrenceKey,
        },
      });
      targetWorkflowId = createdWf.id;
    }

    if (!targetWorkflowId) {
      throw new SchedulerError(`Job [${job.id}] has no valid workflowId or workflowTemplate.`, "EXECUTION_ERROR", job.id);
    }

    // Execute through existing WorkflowEngine pipeline
    let wf = getWorkflow(targetWorkflowId);
    if (!wf) {
      throw new SchedulerError(`Target workflow [${targetWorkflowId}] not found for job [${job.id}].`, "EXECUTION_ERROR", job.id);
    }

    if (wf.status === "PENDING") {
      wf = await startWorkflow(targetWorkflowId);
    }

    const completedWf = await executeAllSteps(targetWorkflowId);

    if (completedWf.status === "FAILED") {
      throw new SchedulerError(`Workflow [${targetWorkflowId}] failed during scheduled execution.`, "EXECUTION_ERROR", job.id);
    }

    // Success Path
    const now = Date.now();
    job.executionCount++;
    job.lastRunAt = now;

    if (job.schedule.type === "ONCE") {
      job.status = "COMPLETED";
      job.nextRunAt = undefined;
      incrementCounter("scheduler.job.completed");
    } else {
      job.nextRunAt = calculateNextRunAt(job.schedule, now);
    }

    job.updatedAt = now;
    updateTask(`job_${job.id}`, () => mapJobToTaskState(job));
    persistScheduleToDb(job);
    recordOccurrenceOutcomeInDb(occurrenceKey, "SUCCESS", undefined, {
      title: job.name,
      body: job.description || job.name,
    });

    log.info(`ScheduledJob occurrence [${occurrenceKey}] completed successfully.`);
    incrementCounter("scheduler.execution.completed");

    return {
      jobId: job.id,
      occurrenceKey,
      scheduledTime,
      executedTime: now,
      workflowId: targetWorkflowId,
      status: "SUCCESS",
    };
  } catch (err: any) {
    // Failure Path
    const now = Date.now();
    job.failureCount++;
    job.lastRunAt = now;

    if (job.schedule.type === "ONCE") {
      job.status = "FAILED";
      job.nextRunAt = undefined;
    } else {
      job.nextRunAt = calculateNextRunAt(job.schedule, now);
    }

    job.updatedAt = now;
    updateTask(`job_${job.id}`, () => mapJobToTaskState(job));
    persistScheduleToDb(job);
    recordOccurrenceOutcomeInDb(occurrenceKey, "FAILED", err.message || String(err));

    log.error(`ScheduledJob occurrence [${occurrenceKey}] failed: ${err.message}`);
    incrementCounter("scheduler.execution.failed");

    return {
      jobId: job.id,
      occurrenceKey,
      scheduledTime,
      executedTime: now,
      workflowId: targetWorkflowId,
      status: "FAILED",
      error: err.message || String(err),
    };
  }
}

/**
 * Manually triggers a scheduled job immediately.
 */
export async function triggerScheduleNow(jobId: string): Promise<ScheduledJobExecution> {
  const job = getSchedule(jobId);
  if (!job) {
    throw new SchedulerError(`Schedule [${jobId}] not found.`, "JOB_NOT_FOUND", jobId);
  }
  return executeScheduledJob(job, Date.now());
}

// ─── Background Polling Loop ───────────────────────────────────────────────────

/**
 * Runs one scheduler polling tick: checks due schedules and executes them.
 */
export async function tick(fromTimeMs: number = Date.now()): Promise<ScheduledJobExecution[]> {
  incrementCounter("scheduler.tick");

  // Phase 1: Resume waiting workflows (isolated)
  try {
    await resumeWaitingWorkflows(fromTimeMs);
  } catch (err: any) {
    log.error(`Scheduler tick error in resumeWaitingWorkflows: ${err.message}`, err);
  }

  // Phase 2: Due schedules lookup (isolated)
  let dueJobs: ScheduledJob[] = [];
  try {
    dueJobs = getDueSchedules(fromTimeMs);
  } catch (err: any) {
    log.error(`Scheduler tick error in getDueSchedules: ${err.message}`, err);
    return [];
  }

  if (dueJobs.length === 0) return [];

  log.info(`Scheduler tick found ${dueJobs.length} due job(s).`);
  const executions: ScheduledJobExecution[] = [];

  // Phase 3: Execute each due job independently so one failing job never blocks others
  for (const job of dueJobs) {
    incrementCounter("scheduler.job.due");
    const scheduledTime = job.nextRunAt || fromTimeMs;
    try {
      const exec = await executeScheduledJob(job, scheduledTime);
      executions.push(exec);
    } catch (err: any) {
      log.error(`Scheduler execution error for job [${job.id}] "${job.name}": ${err.message}`, err);
      executions.push({
        jobId: job.id,
        occurrenceKey: `${job.id}:${scheduledTime}`,
        scheduledTime,
        executedTime: Date.now(),
        status: "FAILED",
        error: err.message || String(err),
      });
    }
  }

  return executions;
}

/**
 * Starts the background scheduler loop.
 */
export function start(pollIntervalMs: number = 1000): void {
  syncFromDb();
  if (isPolling) {
    log.info("Scheduler background loop is already running.");
    return;
  }

  isPolling = true;
  log.info(`Starting Scheduler background loop with pollInterval = ${pollIntervalMs}ms...`);
  incrementCounter("scheduler.started");

  pollTimer = setInterval(() => {
    tick().catch((err) => {
      log.error(`Scheduler background tick error: ${err.message}`, err);
    });
  }, pollIntervalMs);
}

/**
 * Stops the background scheduler loop cleanly.
 */
export function stop(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  isPolling = false;
  log.info("Scheduler background loop stopped.");
  incrementCounter("scheduler.stopped");
}

/**
 * Returns whether the background scheduler loop is active.
 */
export function isRunning(): boolean {
  return isPolling;
}
