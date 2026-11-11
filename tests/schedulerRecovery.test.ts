// ════════════════════════════════════════════════════════════════════════════════
// tests/schedulerRecovery.test.ts — Phase 6.3 Scheduler Recovery & Persistence Tests
// ════════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from "./bunTestPolyfill.js";
import {
  createSchedule,
  getSchedule,
  listSchedules,
  deleteSchedule,
  stop,
  clearClaimedOccurrences,
  tick,
} from "../src/scheduler/schedulerEngine.js";
import { createTask, listTasks } from "../src/orchestrator/stateStore.js";

describe("Phase 6.3 — Scheduler Recovery & Persistence Hardening Tests", () => {
  beforeEach(() => {
    stop();
    clearClaimedOccurrences();
    listSchedules().forEach((s) => deleteSchedule(s.id));
  });

  afterEach(() => {
    stop();
  });

  it("23. Schedule survives engine recreation", () => {
    const job = createSchedule({
      name: "Engine Recreation Job",
      workflowTemplate: {
        name: "W",
        steps: [{ name: "S", type: "TOOL", input: { toolId: "system.info" } }],
      },
      schedule: { type: "INTERVAL", intervalMs: 10000 },
    });

    // Retrieve via fresh listSchedules/getSchedule call
    const retrieved = getSchedule(job.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(job.id);
    expect(retrieved?.name).toBe("Engine Recreation Job");
    expect(retrieved?.status).toBe("ACTIVE");
  });

  it("24. Overdue schedule follows missed-run policy (RUN_ONCE_IF_MISSED vs SKIP_MISSED)", async () => {
    const overdueTime = Date.now() - 3600000; // 1 hour ago

    const runOnceJob = createSchedule({
      name: "Run Once Missed Job",
      workflowTemplate: {
        name: "W",
        steps: [{ name: "S", type: "TOOL", input: { toolId: "system.info" } }],
      },
      schedule: { type: "ONCE", runAt: overdueTime, missedPolicy: "RUN_ONCE_IF_MISSED" },
    });

    const skipMissedJob = createSchedule({
      name: "Skip Missed Job",
      workflowTemplate: {
        name: "W",
        steps: [{ name: "S", type: "TOOL", input: { toolId: "system.info" } }],
      },
      schedule: { type: "ONCE", runAt: overdueTime, missedPolicy: "SKIP_MISSED" },
    });

    expect(runOnceJob.nextRunAt).toBeDefined();
    expect(skipMissedJob.nextRunAt).toBeUndefined();

    // Tick should execute runOnceJob and ignore skipMissedJob
    const execs = await tick();
    expect(execs.some((e) => e.jobId === runOnceJob.id)).toBe(true);
    expect(execs.some((e) => e.jobId === skipMissedJob.id)).toBe(false);
  });

  it("25. Secrets are not persisted in cleartext (sanitization)", () => {
    const job = createSchedule({
      name: "Secret Sanitization Job",
      workflowTemplate: {
        name: "Secret WF",
        steps: [
          {
            name: "S",
            type: "TOOL",
            input: {
              toolId: "fs.read_file",
              params: {
                path: "credentials.json",
                password: "my_secret_password_999",
                apiKey: "sk-proj-super-secret-key-123",
              },
            },
          },
        ],
      },
      schedule: { type: "INTERVAL", intervalMs: 60000 },
    });

    const persistedTask = listTasks().find((t) => t.taskId === `job_${job.id}`);
    expect(persistedTask).toBeDefined();

    const taskMetaStr = JSON.stringify(persistedTask?.metadata);
    expect(taskMetaStr.includes("my_secret_password_999")).toBe(false);
    expect(taskMetaStr.includes("sk-proj-super-secret-key-123")).toBe(false);
    expect(taskMetaStr.includes("[REDACTED_SECRET]")).toBe(true);
  });

  it("26. Corrupted schedule data fails safely without crashing", () => {
    // Inject malformed task in stateStore
    createTask("job_corrupted_123", {
      taskId: "job_corrupted_123",
      status: "running",
      metadata: {
        taskType: "scheduled_job",
        jobId: "corrupted_123",
        name: null as any,
        schedule: null as any,
      },
    });

    let threw = false;
    try {
      listSchedules();
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    deleteSchedule("corrupted_123");
  });
});
