import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createTask,
  updateTask,
  getTask,
  listTasks,
  deleteTask,
  deepClone,
} from "../src/orchestrator/stateStore.js";
import {
  createSchedule,
  getDueSchedules,
  tick,
  stop as stopSchedulerEngine,
  deleteSchedule,
  syncFromDb,
} from "../src/scheduler/schedulerEngine.js";
import { setNotificationAdapter } from "../src/scheduler/notificationService.js";

describe("StateStore & Scheduler Deep Cloning & Resiliency", () => {
  beforeEach(() => {
    stopSchedulerEngine();
  });

  afterEach(() => {
    stopSchedulerEngine();
  });

  it("1. deepClone clones normal primitive, array, and nested object state without loss", () => {
    const original = {
      taskId: "task-1",
      status: "pending" as const,
      steps: [{ id: "step1", name: "Step 1" }],
      metadata: { priority: "high", count: 42, active: true, tag: null, opt: undefined },
      createdAt: "2026-10-19T13:00:00.000Z",
      updatedAt: "2026-10-19T13:00:00.000Z",
    };

    const cloned = deepClone(original);
    expect(cloned).toEqual(original);
    expect(cloned).not.toBe(original);
    expect(cloned.steps).not.toBe(original.steps);
    expect(cloned.steps[0]).not.toBe(original.steps[0]);
    expect(cloned.metadata).not.toBe(original.metadata);
  });

  it("2. deepClone preserves functions without throwing DataCloneError", async () => {
    let executed = false;
    const taskWithFn = {
      taskId: "job_proactive_battery_check",
      status: "pending" as const,
      steps: [],
      metadata: {
        workflowTemplate: {
          steps: [
            {
              name: "Battery Monitoring",
              type: "ACTION",
              input: {
                actionName: "checkBatteryAlert",
                actionFn: async () => {
                  executed = true;
                  return { battery: "100%" };
                },
              },
            },
          ],
        },
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Must not throw DataCloneError
    const cloned = deepClone(taskWithFn);
    expect(cloned.taskId).toBe("job_proactive_battery_check");
    expect(typeof cloned.metadata.workflowTemplate.steps[0].input.actionFn).toBe("function");

    const result = await cloned.metadata.workflowTemplate.steps[0].input.actionFn();
    expect(executed).toBe(true);
    expect(result).toEqual({ battery: "100%" });
  });

  it("3. Mutating a cloned object does NOT mutate the original store state", () => {
    const task = createTask("isolation-test-1", {
      status: "pending",
      steps: [{ id: "step-1", status: "PENDING" }],
      metadata: { config: { retries: 3 } },
    });

    // Mutate the returned clone
    (task.steps[0] as any).status = "COMPLETED";
    (task.metadata as any).config.retries = 99;

    // Fetch from store again
    const fresh = getTask("isolation-test-1");
    expect((fresh?.steps[0] as any).status).toBe("PENDING");
    expect((fresh?.metadata as any).config.retries).toBe(3);

    deleteTask("isolation-test-1");
  });

  it("4. deepClone preserves Dates, Sets, Maps, and RegExps without coercion to strings or plain objects", () => {
    const testDate = new Date("2026-10-19T13:30:00.000Z");
    const testRegex = /^[a-z0-9_-]+$/gi;
    const testMap = new Map<string, number>([["a", 1], ["b", 2]]);
    const testSet = new Set<string>(["alpha", "beta"]);

    const compound = {
      date: testDate,
      regex: testRegex,
      map: testMap,
      set: testSet,
    };

    const cloned = deepClone(compound);

    // Verify instances
    expect(cloned.date instanceof Date).toBe(true);
    expect(cloned.date.getTime()).toBe(testDate.getTime());
    expect(cloned.date).not.toBe(testDate);

    expect(cloned.regex instanceof RegExp).toBe(true);
    expect(cloned.regex.source).toBe(testRegex.source);
    expect(cloned.regex.flags).toBe(testRegex.flags);
    expect(cloned.regex).not.toBe(testRegex);

    expect(cloned.map instanceof Map).toBe(true);
    expect(cloned.map.get("a")).toBe(1);
    expect(cloned.map.get("b")).toBe(2);
    expect(cloned.map).not.toBe(testMap);

    expect(cloned.set instanceof Set).toBe(true);
    expect(cloned.set.has("alpha")).toBe(true);
    expect(cloned.set.has("beta")).toBe(true);
    expect(cloned.set).not.toBe(testSet);
  });

  it("5. Circular references are safely cloned without infinite recursion or stack overflow", () => {
    const circA: any = { name: "A" };
    const circB: any = { name: "B", a: circA };
    circA.b = circB;

    const clonedA = deepClone(circA);
    expect(clonedA).not.toBe(circA);
    expect(clonedA.name).toBe("A");
    expect(clonedA.b.name).toBe("B");
    expect(clonedA.b.a).toBe(clonedA); // Circular reference points to the cloned instance!
  });

  it("6. createTask and listTasks succeed with realistic proactive job fixtures", () => {
    const proactiveFixture = {
      taskId: "job_proactive_test_briefing",
      status: "pending" as const,
      steps: [],
      outputs: [],
      artifacts: [],
      errors: [],
      metadata: {
        taskType: "scheduled_job",
        jobId: "proactive_test_briefing",
        name: "Morning Briefing",
        workflowTemplate: {
          name: "Morning Briefing Workflow",
          steps: [
            {
              name: "Morning Briefing",
              type: "ACTION",
              input: {
                actionName: "generateMorningBriefing",
                actionFn: async () => ({ briefing: "Good morning!" }),
              },
            },
          ],
        },
      },
    };

    createTask(proactiveFixture.taskId, proactiveFixture);

    const allTasks = listTasks();
    const found = allTasks.find((t) => t.taskId === proactiveFixture.taskId);
    expect(found).toBeDefined();
    expect(found?.metadata?.name).toBe("Morning Briefing");

    deleteTask(proactiveFixture.taskId);
  });

  it("7. A failing job during scheduler tick does not block or abort unrelated valid jobs", async () => {
    const now = Date.now();

    // Job 1: Broken template that will fail execution
    const failingJob = createSchedule({
      id: "failing_job_" + now,
      name: "Failing Test Job",
      schedule: { type: "ONCE", runAt: now - 1000 },
      workflowTemplate: {
        name: "Failing Workflow",
        steps: [
          {
            id: "fail_step",
            name: "Failing Step",
            type: "TOOL",
            input: {
              toolId: "non_existent_invalid_tool_xyz_999",
              params: {},
            },
          },
        ],
      },
    });

    // Job 2: Valid job that should succeed despite Job 1 failing
    let validJobExecuted = false;
    const validJob = createSchedule({
      id: "valid_job_" + now,
      name: "Valid Test Job",
      schedule: { type: "ONCE", runAt: now - 1000 },
      workflowTemplate: {
        name: "Valid Workflow",
        steps: [
          {
            id: "valid_step",
            name: "Valid Action",
            type: "ACTION",
            input: {
              actionName: "validAction",
              actionFn: async () => {
                validJobExecuted = true;
                return { ok: true };
              },
            },
          },
        ],
      },
    });

    // Execute scheduler tick with slightly advanced time so both jobs are due
    const executions = await tick(now + 5000);

    // Both executions should be accounted for; Job 1 failed, Job 2 succeeded!
    expect(executions.length).toBeGreaterThanOrEqual(2);

    const failExec = executions.find((e) => e.jobId === failingJob.id);
    expect(failExec?.status).toBe("FAILED");

    const validExec = executions.find((e) => e.jobId === validJob.id);
    expect(validExec?.status).toBe("SUCCESS");
    expect(validJobExecuted).toBe(true);

    deleteSchedule(failingJob.id);
    deleteSchedule(validJob.id);
  });

  it("8. Reminder notification execution succeeds alongside proactive ACTION steps", async () => {
    const delivered: any[] = [];
    setNotificationAdapter(async (payload) => {
      delivered.push(payload);
      return { success: true, channel: "mock", deliveredAt: Date.now() };
    });

    const now = Date.now();

    const reminderJob = createSchedule({
      id: "reminder_cloning_test_" + now,
      name: "Reminder: check notifications",
      schedule: { type: "ONCE", runAt: now - 500 },
      workflowTemplate: {
        name: "Notify Reminder: check notifications",
        steps: [
          {
            id: "notify",
            name: "Display Notification",
            type: "TOOL",
            input: {
              toolId: "system.notify",
              params: {
                title: "Creater AI — Reminder",
                message: "It's time to check notifications.",
                reminderTitle: "check notifications",
              },
            },
          },
        ],
      },
    });

    const executions = await tick(now);
    const remExec = executions.find((e) => e.jobId === reminderJob.id);
    expect(remExec?.status).toBe("SUCCESS");
    expect(delivered.length).toBe(1);
    expect(delivered[0].title).toBe("Creater AI — Reminder");

    // Clean up
    deleteSchedule(reminderJob.id);
    setNotificationAdapter(null);
  });

  it("9. Repeated ticks execute cleanly across multiple intervals without recurring cloning errors", async () => {
    const now = Date.now();
    const proactiveJobs = [
      createSchedule({
        id: "proactive_test_1_" + now,
        name: "Proactive Battery Check",
        schedule: { type: "CRON", cronExpression: "0 * * * *" },
        workflowTemplate: {
          name: "Battery Workflow",
          steps: [{ name: "Check Battery", type: "ACTION", input: { actionFn: async () => ({ battery: "98%" }) } }],
        },
      }),
      createSchedule({
        id: "proactive_test_2_" + now,
        name: "Proactive Memory Cleanup",
        schedule: { type: "CRON", cronExpression: "0 0 * * *" },
        workflowTemplate: {
          name: "Memory Workflow",
          steps: [{ name: "Clean Memory", type: "ACTION", input: { actionFn: async () => ({ cleaned: true }) } }],
        },
      }),
    ];

    // Execute 5 consecutive ticks (simulating 5 seconds of scheduler background polling)
    for (let i = 0; i < 5; i++) {
      const executions = await tick(now + i * 1000);
      expect(Array.isArray(executions)).toBe(true);
    }

    // Clean up
    for (const job of proactiveJobs) {
      deleteSchedule(job.id);
    }
  });

  it("10. Unsupported or throwing values produce controlled diagnosable error without crashing listTasks or tick", async () => {
    // Inject a task with a throwing getter
    const badTask: any = {
      taskId: "task_with_throwing_getter",
      status: "pending",
      steps: [],
      metadata: {},
    };
    Object.defineProperty(badTask, "poisonProperty", {
      enumerable: true,
      get() {
        throw new Error("Deliberate clone inspection error");
      },
    });

    // Directly put into stateStore
    createTask("task_with_throwing_getter", badTask);

    // listTasks must not throw unhandled exception; it catches and logs
    const tasks = listTasks();
    expect(Array.isArray(tasks)).toBe(true);

    // tick() must also not crash when bad task exists
    const executions = await tick();
    expect(Array.isArray(executions)).toBe(true);

    deleteTask("task_with_throwing_getter");
  });

  it("11. Reminder executes once when due and duplicate prevention stops re-execution on subsequent ticks", async () => {
    let notifyCallCount = 0;
    setNotificationAdapter(async () => {
      notifyCallCount++;
      return { success: true, channel: "mock", deliveredAt: Date.now() };
    });

    const now = Date.now();
    const onceJob = createSchedule({
      id: "once_reminder_dedup_" + now,
      name: "Reminder: Take Medicine",
      schedule: { type: "ONCE", runAt: now - 1000 },
      workflowTemplate: {
        name: "Notify Medicine",
        steps: [
          {
            id: "step_notify",
            name: "Notify",
            type: "TOOL",
            input: {
              toolId: "system.notify",
              params: { title: "Reminder", message: "Take medicine" },
            },
          },
        ],
      },
    });

    // Tick 1: Should execute and fire notification
    const exec1 = await tick(now);
    expect(exec1.length).toBeGreaterThanOrEqual(1);
    expect(notifyCallCount).toBe(1);

    // Tick 2 (next second): Must NOT execute again
    const exec2 = await tick(now + 1000);
    const reExec = exec2.find((e) => e.jobId === onceJob.id);
    expect(reExec).toBeUndefined();
    expect(notifyCallCount).toBe(1); // Still 1!

    deleteSchedule(onceJob.id);
    setNotificationAdapter(null);
  });

  it("12. Restart recovery preserves persistence and occurrence claim locking across engine instances", async () => {
    const now = Date.now();
    const jobId = "sched_restart_test_" + now;
    const occurrenceKey = `${jobId}:${now}`;

    // Record an occurrence claim in SQLite DB as already SUCCESS
    const db = (await import("../src/memory/db.js")).getDB();
    db.prepare(`
      INSERT OR REPLACE INTO schedule_occurrences (
        id, schedule_id, occurrence_key, scheduled_time, executed_time, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'SUCCESS', ?)
    `).run(`occ_${now}`, jobId, occurrenceKey, now, now, now);

    // Simulate engine restart by clearing in-memory claim set
    const { claimOccurrence, clearClaimedOccurrences } = await import("../src/scheduler/schedulerEngine.js");
    clearClaimedOccurrences();

    // Occurrence claim must be rejected because DB has SUCCESS record
    const claimedAgain = claimOccurrence(jobId, occurrenceKey, now);
    expect(claimedAgain).toBe(false);

    // Clean up
    db.prepare("DELETE FROM schedule_occurrences WHERE schedule_id = ?").run(jobId);
  });
});

