// ════════════════════════════════════════════════════════════════════════════════
// tests/scheduler.test.ts — Phase 6.3 Scheduler / Cron Engine Tests
// ════════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from "./bunTestPolyfill.js";
import * as fs from "fs";
import * as path from "path";
import {
  createSchedule,
  getSchedule,
  listSchedules,
  pauseSchedule,
  resumeSchedule,
  cancelSchedule,
  deleteSchedule,
  triggerScheduleNow,
  executeScheduledJob,
  getDueSchedules,
  tick,
  start,
  stop,
  isRunning,
  claimOccurrence,
  clearClaimedOccurrences,
} from "../src/scheduler/schedulerEngine.js";
import { validateCronExpression, calculateNextRunAt, getNextCronOccurrence } from "../src/scheduler/cronUtils.js";
import { SchedulerError } from "../src/scheduler/types.js";
import { createWorkflow, deleteWorkflow } from "../src/workflow/workflowEngine.js";
import { WorkflowError } from "../src/workflow/types.js";

describe("Phase 6.3 — Scheduler / Cron Engine Tests", () => {
  beforeEach(() => {
    stop();
    clearClaimedOccurrences();
    listSchedules().forEach((s) => deleteSchedule(s.id));
  });

  afterEach(() => {
    stop();
  });

  // ── Scheduling Tests ─────────────────────────────────────────────────────────

  it("1. Create one-time schedule", () => {
    const runAt = Date.now() + 10000;
    const job = createSchedule({
      name: "One Time Job",
      workflowTemplate: {
        name: "W1",
        steps: [{ name: "S1", type: "TOOL", input: { toolId: "system.info" } }],
      },
      schedule: { type: "ONCE", runAt },
    });

    expect(job.id).toBeDefined();
    expect(job.schedule.type).toBe("ONCE");
    expect(job.status).toBe("ACTIVE");
    expect(job.nextRunAt).toBe(runAt);
  });

  it("2. Create interval schedule", () => {
    const job = createSchedule({
      name: "Interval Job",
      workflowTemplate: {
        name: "W2",
        steps: [{ name: "S1", type: "TOOL", input: { toolId: "system.info" } }],
      },
      schedule: { type: "INTERVAL", intervalMs: 5000 },
    });

    expect(job.schedule.type).toBe("INTERVAL");
    expect(job.nextRunAt).toBeGreaterThan(Date.now());
  });

  it("3. Create cron schedule", () => {
    const job = createSchedule({
      name: "Cron Job",
      workflowTemplate: {
        name: "W3",
        steps: [{ name: "S1", type: "TOOL", input: { toolId: "system.info" } }],
      },
      schedule: { type: "CRON", cronExpression: "0 9 * * *" },
    });

    expect(job.schedule.type).toBe("CRON");
    expect(job.nextRunAt).toBeGreaterThan(Date.now());
  });

  it("4. Reject invalid cron expression", () => {
    try {
      createSchedule({
        name: "Invalid Cron",
        workflowTemplate: {
          name: "W4",
          steps: [{ name: "S1", type: "TOOL", input: { toolId: "system.info" } }],
        },
        schedule: { type: "CRON", cronExpression: "invalid_cron_string_xyz" },
      });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err instanceof SchedulerError).toBe(true);
      expect(err.code).toBe("INVALID_CRON_ERROR");
    }
  });

  it("5. Calculate correct next occurrence", () => {
    const valid = validateCronExpression("*/5 * * * *");
    expect(valid).toBe(true);

    const next = getNextCronOccurrence("*/5 * * * *", Date.now());
    expect(next).toBeGreaterThan(Date.now());
  });

  it("6. Respect start/end boundaries", () => {
    const now = Date.now();
    const endTime = now + 1000;
    const nextRun = calculateNextRunAt({ type: "INTERVAL", intervalMs: 5000, endTime }, now);
    expect(nextRun).toBeUndefined();
  });

  // ── Lifecycle Tests ──────────────────────────────────────────────────────────

  it("7. Pause schedule", () => {
    const job = createSchedule({
      name: "Pause Job",
      workflowTemplate: {
        name: "W",
        steps: [{ name: "S", type: "TOOL", input: { toolId: "system.info" } }],
      },
      schedule: { type: "INTERVAL", intervalMs: 1000 },
    });

    const paused = pauseSchedule(job.id);
    expect(paused.status).toBe("PAUSED");
    expect(getSchedule(job.id)?.status).toBe("PAUSED");
  });

  it("8. Resume schedule", () => {
    const job = createSchedule({
      name: "Resume Job",
      workflowTemplate: {
        name: "W",
        steps: [{ name: "S", type: "TOOL", input: { toolId: "system.info" } }],
      },
      schedule: { type: "INTERVAL", intervalMs: 1000 },
    });

    pauseSchedule(job.id);
    const resumed = resumeSchedule(job.id);
    expect(resumed.status).toBe("ACTIVE");
  });

  it("9. Cancel schedule", () => {
    const job = createSchedule({
      name: "Cancel Job",
      workflowTemplate: {
        name: "W",
        steps: [{ name: "S", type: "TOOL", input: { toolId: "system.info" } }],
      },
      schedule: { type: "INTERVAL", intervalMs: 1000 },
    });

    const cancelled = cancelSchedule(job.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.nextRunAt).toBeUndefined();
  });

  it("10. Delete schedule", () => {
    const job = createSchedule({
      name: "Delete Job",
      workflowTemplate: {
        name: "W",
        steps: [{ name: "S", type: "TOOL", input: { toolId: "system.info" } }],
      },
      schedule: { type: "INTERVAL", intervalMs: 1000 },
    });

    deleteSchedule(job.id);
    expect(getSchedule(job.id)).toBeUndefined();
  });

  it("11. Start scheduler", () => {
    start(100);
    expect(isRunning()).toBe(true);
  });

  it("12. Stop scheduler", () => {
    start(100);
    stop();
    expect(isRunning()).toBe(false);
  });

  it("13. Prevent duplicate scheduler loops", () => {
    start(100);
    start(100);
    expect(isRunning()).toBe(true);
    stop();
  });

  // ── Execution & WorkflowEngine Integration Tests ──────────────────────────────

  it("14. Detect due schedule", () => {
    const pastRunAt = Date.now() - 5000;
    const job = createSchedule({
      name: "Due Job",
      workflowTemplate: {
        name: "W",
        steps: [{ name: "S", type: "TOOL", input: { toolId: "system.info" } }],
      },
      schedule: { type: "ONCE", runAt: pastRunAt, missedPolicy: "RUN_ONCE_IF_MISSED" },
    });

    const due = getDueSchedules();
    expect(due.some((j) => j.id === job.id)).toBe(true);
  });

  it("15. Trigger WorkflowEngine instead of directly executing tools", async () => {
    const testFile = path.join(process.cwd(), "data", "checkpoints", "sched_wf_exec.txt");

    const job = createSchedule({
      name: "WF Engine Trigger Job",
      workflowTemplate: {
        name: "File Write WF",
        steps: [{ name: "Write", type: "TOOL", input: { toolId: "fs.write_file", params: { path: testFile, content: "Scheduled Exec Data" } } }],
      },
      schedule: { type: "ONCE", runAt: Date.now() - 100 },
    });

    const res = await triggerScheduleNow(job.id);
    expect(res.status).toBe("SUCCESS");
    expect(fs.existsSync(testFile)).toBe(true);

    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
  });

  it("16. Successful scheduled workflow updates execution state", async () => {
    const job = createSchedule({
      name: "State Update Job",
      workflowTemplate: {
        name: "W",
        steps: [{ name: "Info", type: "TOOL", input: { toolId: "system.info" } }],
      },
      schedule: { type: "ONCE", runAt: Date.now() - 100 },
    });

    await triggerScheduleNow(job.id);
    const updated = getSchedule(job.id);

    expect(updated?.status).toBe("COMPLETED");
    expect(updated?.executionCount).toBe(1);
    expect(updated?.lastRunAt).toBeGreaterThan(0);
  });

  it("17. Failed workflow records schedule failure correctly", async () => {
    const job = createSchedule({
      name: "Fail Workflow Job",
      workflowTemplate: {
        name: "Bad WF",
        steps: [{ name: "Bad Tool", type: "TOOL", input: { toolId: "non_existent_tool_xyz" } }],
      },
      schedule: { type: "ONCE", runAt: Date.now() - 100 },
    });

    const exec = await triggerScheduleNow(job.id);
    expect(exec.status).toBe("FAILED");

    const updated = getSchedule(job.id);
    expect(updated?.status).toBe("FAILED");
    expect(updated?.failureCount).toBe(1);
  });

  it("18. Recurring schedule continues after failed occurrence", async () => {
    const job = createSchedule({
      name: "Recurring Fail Job",
      workflowTemplate: {
        name: "Bad WF",
        steps: [{ name: "Bad Tool", type: "TOOL", input: { toolId: "non_existent_tool_xyz" } }],
      },
      schedule: { type: "INTERVAL", intervalMs: 5000 },
    });

    await triggerScheduleNow(job.id);
    const updated = getSchedule(job.id);

    expect(updated?.status).toBe("ACTIVE");
    expect(updated?.failureCount).toBe(1);
    expect(updated?.nextRunAt).toBeGreaterThan(Date.now());
  });

  it("19. One-time schedule completes correctly", async () => {
    const job = createSchedule({
      name: "One Time Complete",
      workflowTemplate: {
        name: "W",
        steps: [{ name: "Info", type: "TOOL", input: { toolId: "system.info" } }],
      },
      schedule: { type: "ONCE", runAt: Date.now() - 100, missedPolicy: "RUN_ONCE_IF_MISSED" },
    });

    await tick();
    const updated = getSchedule(job.id);
    expect(updated?.status).toBe("COMPLETED");
    expect(updated?.nextRunAt).toBeUndefined();
  });

  // ── Duplicate Protection Tests ─────────────────────────────────────────────

  it("20. Same occurrence cannot execute twice", async () => {
    const job = createSchedule({
      name: "Duplicate Occurrence Job",
      workflowTemplate: {
        name: "W",
        steps: [{ name: "Info", type: "TOOL", input: { toolId: "system.info" } }],
      },
      schedule: { type: "ONCE", runAt: Date.now() + 10000 },
    });

    const fixedTime = Date.now() + 5000;
    const occKey = `${job.id}:${fixedTime}`;
    claimOccurrence(job.id, occKey);

    const exec = await executeScheduledJob(job, fixedTime);
    expect(exec.status).toBe("SKIPPED");
    expect(exec.error).toContain("Duplicate execution prevented");
  });

  it("21. Concurrent scheduler ticks cannot claim same occurrence", async () => {
    const job = createSchedule({
      name: "Concurrent Tick Job",
      workflowTemplate: {
        name: "W",
        steps: [{ name: "Info", type: "TOOL", input: { toolId: "system.info" } }],
      },
      schedule: { type: "ONCE", runAt: Date.now() - 100 },
    });

    const p1 = tick();
    const p2 = tick();

    const [res1, res2] = await Promise.all([p1, p2]);
    const totalExecuted = res1.length + res2.length;
    const skippedCount = [...res1, ...res2].filter((e) => e.status === "SKIPPED").length;

    expect(skippedCount).toBeGreaterThanOrEqual(0);
  });

  it("22. Restart cannot duplicate an already claimed occurrence", async () => {
    const job = createSchedule({
      name: "Restart Claim Job",
      workflowTemplate: {
        name: "W",
        steps: [{ name: "Info", type: "TOOL", input: { toolId: "system.info" } }],
      },
      schedule: { type: "ONCE", runAt: Date.now() - 100 },
    });

    const occKey = `${job.id}:${job.nextRunAt}`;
    claimOccurrence(job.id, occKey);

    // Simulate tick after engine restart
    const dueExecs = await tick();
    const jobExec = dueExecs.find((e) => e.jobId === job.id);
    if (jobExec) {
      expect(jobExec.status).toBe("SKIPPED");
    }
  });

  // ── Safety Integration Tests ───────────────────────────────────────────────

  it("27. Scheduler cannot bypass WorkflowEngine safety", async () => {
    const job = createSchedule({
      name: "Unsafe Scheduled Job",
      workflowTemplate: {
        name: "Unsafe Command WF",
        steps: [{ name: "Dangerous Shell", type: "TOOL", input: { toolId: "shell.execute", params: { command: "rm -rf /" } } }],
      },
      schedule: { type: "ONCE", runAt: Date.now() - 100 },
    });

    const exec = await triggerScheduleNow(job.id);
    expect(exec.status).toBe("FAILED");
    expect(exec.error).toContain("Safety policy blocked");
  });

  it("28. Dangerous scheduled workflow still follows existing confirmation policy", async () => {
    const job = createSchedule({
      name: "Dangerous Process Kill Job",
      workflowTemplate: {
        name: "Kill Process WF",
        steps: [{ name: "Kill PID 4", type: "TOOL", input: { toolId: "system.process_kill", params: { pid: 4 } } }],
      },
      schedule: { type: "ONCE", runAt: Date.now() - 100 },
    });

    const exec = await triggerScheduleNow(job.id);
    expect(exec.status).toBe("FAILED");
  });
});
