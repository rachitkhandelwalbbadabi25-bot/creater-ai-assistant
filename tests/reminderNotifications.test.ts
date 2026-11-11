// ════════════════════════════════════════════════════════════════════════════════
// tests/reminderNotifications.test.ts — Phase E: Reminder Notification Verification
// ════════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach, afterEach } from "./bunTestPolyfill.js";
import {
  createSchedule,
  getSchedule,
  listSchedules,
  deleteSchedule,
  cancelSchedule,
  tick,
  stop,
  clearClaimedOccurrences,
  syncFromDb,
  getDbOccurrences,
} from "../src/scheduler/schedulerEngine.js";
import {
  setNotificationAdapter,
  NotificationPayload,
  NotificationDeliveryResult,
  clearNotificationHistory,
  getRecentNotifications,
  onInAppNotification,
} from "../src/scheduler/notificationService.js";
import { createReminder } from "../src/scheduler/reminderTools.js";
import { parseReminderCommand } from "../src/graph/commandRouter.js";
import { cleanPendingReminderContent } from "../src/conversation/pendingIntentStore.js";

describe("Phase E — Reminder Notification & Delivery Verification", () => {
  let deliveredNotifications: NotificationPayload[] = [];
  let shouldFailDelivery = false;

  beforeEach(() => {
    stop();
    clearClaimedOccurrences();
    clearNotificationHistory();
    deliveredNotifications = [];
    shouldFailDelivery = false;

    // Clean up any test schedules from previous runs
    for (const s of listSchedules()) {
      deleteSchedule(s.id);
    }

    // Inject mock notification adapter for deterministic, clock-controlled testing
    setNotificationAdapter(async (payload: NotificationPayload): Promise<NotificationDeliveryResult> => {
      if (shouldFailDelivery) {
        throw new Error("Network / OS toast delivery temporary failure");
      }
      deliveredNotifications.push(payload);
      return {
        success: true,
        channel: "mock",
        deliveredAt: Date.now(),
      };
    });
  });

  afterEach(() => {
    stop();
    setNotificationAdapter(null);
  });

  it("1. Due reminder triggers exactly one notification", async () => {
    const fixedTime = Date.now() - 500; // Due in past (due now)
    const reminderRes = await createReminder({
      title: "open YouTube",
      scheduledAt: fixedTime,
      channel: "test_notify_1",
    });

    expect(reminderRes.success).toBe(true);
    expect(deliveredNotifications.length).toBe(0); // Not delivered on creation!

    // Tick scheduler at current time
    const execs = await tick(Date.now());
    expect(execs.length).toBeGreaterThan(0);
    expect(deliveredNotifications.length).toBe(1);
    expect(deliveredNotifications[0].title).toBe("Creater AI — Reminder");
    expect(deliveredNotifications[0].body).toContain("open YouTube");
  });

  it("2. Future reminder does not trigger early", async () => {
    const futureTime = Date.now() + 60000; // 1 minute in the future
    const reminderRes = await createReminder({
      title: "call doctor",
      scheduledAt: futureTime,
      channel: "test_notify_2",
    });

    expect(reminderRes.success).toBe(true);

    // Tick at current time
    const execs = await tick(Date.now());
    expect(execs.some((e) => e.jobId === reminderRes.reminder?.id)).toBe(false);
    expect(deliveredNotifications.length).toBe(0);

    // Job remains ACTIVE
    const job = getSchedule(reminderRes.reminder!.id);
    expect(job?.status).toBe("ACTIVE");
  });

  it("3. Duplicate scheduler ticks do not duplicate delivery", async () => {
    const dueTime = Date.now() - 1000;
    const reminderRes = await createReminder({
      title: "take medicine",
      scheduledAt: dueTime,
      channel: "test_notify_3",
    });

    // Tick 1 -> delivers once
    await tick(Date.now());
    expect(deliveredNotifications.length).toBe(1);

    // Tick 2 -> should NOT deliver again
    await tick(Date.now() + 1000);
    expect(deliveredNotifications.length).toBe(1);

    // Tick 3 -> should NOT deliver again
    await tick(Date.now() + 2000);
    expect(deliveredNotifications.length).toBe(1);

    const job = getSchedule(reminderRes.reminder!.id);
    expect(job?.status).toBe("COMPLETED");
  });

  it("4. Delivery failures are logged and recorded safely", async () => {
    shouldFailDelivery = true; // Inject failure in adapter
    const dueTime = Date.now() - 1000;
    const reminderRes = await createReminder({
      title: "failed test reminder",
      scheduledAt: dueTime,
      channel: "test_notify_4",
    });

    const execs = await tick(Date.now());
    const jobExec = execs.find((e) => e.jobId === reminderRes.reminder?.id);

    expect(jobExec).toBeDefined();
    expect(jobExec?.status).toBe("FAILED");
    expect(jobExec?.error).toBeDefined();

    const job = getSchedule(reminderRes.reminder!.id);
    expect(job?.status).toBe("FAILED");
    expect(job?.failureCount).toBe(1);
  });

  it("5. Successful delivery is persisted in SQLite occurrences and schedules", async () => {
    const dueTime = Date.now() - 1000;
    const reminderRes = await createReminder({
      title: "check deployment",
      scheduledAt: dueTime,
      channel: "test_notify_5",
    });

    await tick(Date.now());
    expect(deliveredNotifications.length).toBe(1);

    const job = getSchedule(reminderRes.reminder!.id);
    expect(job?.status).toBe("COMPLETED");

    // Verify SQLite occurrences table
    const occs = getDbOccurrences(reminderRes.reminder!.id);
    expect(occs.length).toBeGreaterThan(0);
    expect(occs[0].status).toBe("SUCCESS");
  });

  it("6. Restart recovery does not duplicate an already delivered reminder", async () => {
    const dueTime = Date.now() - 5000;
    const reminderRes = await createReminder({
      title: "restart test reminder",
      scheduledAt: dueTime,
      channel: "test_notify_6",
    });

    // Turn 1: Deliver once
    await tick(Date.now());
    expect(deliveredNotifications.length).toBe(1);

    // Simulate complete application restart: stop engine, recreate in-memory state
    stop();
    syncFromDb();

    // Turn 2: Engine ticks after restart
    await tick(Date.now() + 1000);

    // Delivery count MUST remain exactly 1
    expect(deliveredNotifications.length).toBe(1);
  });

  it("7. Overdue reminders follow defined catch-up policy (within 24h runs once; >24h skipped)", async () => {
    // 7a: Reminder overdue by 2 hours (within 24h grace period)
    const recentOverdue = Date.now() - 2 * 3600 * 1000;
    const r1 = await createReminder({
      title: "overdue within grace period",
      scheduledAt: recentOverdue,
      channel: "test_notify_7a",
    });

    await tick(Date.now());
    expect(deliveredNotifications.some((n) => n.body.includes("overdue within grace period"))).toBe(true);

    // 7b: Reminder overdue by 26 hours (exceeds 24h grace period -> too stale to blast user)
    const veryStale = Date.now() - 26 * 3600 * 1000;
    const r2 = await createReminder({
      title: "very stale reminder",
      scheduledAt: veryStale,
      channel: "test_notify_7b",
    });

    deliveredNotifications = [];
    await tick(Date.now());
    // Stale reminder should NOT burst a notification
    expect(deliveredNotifications.some((n) => n.body.includes("very stale reminder"))).toBe(false);
  });

  it("8. Cancelling a reminder prevents future delivery", async () => {
    const futureTime = Date.now() + 2000;
    const reminderRes = await createReminder({
      title: "cancelled reminder",
      scheduledAt: futureTime,
      channel: "test_notify_8",
    });

    // Cancel before it fires
    cancelSchedule(reminderRes.reminder!.id);
    const job = getSchedule(reminderRes.reminder!.id);
    expect(job?.status).toBe("CANCELLED");

    // Fast-forward tick past the scheduled time
    await tick(Date.now() + 5000);
    expect(deliveredNotifications.length).toBe(0);
  });

  it("9. 'open YouTube' as reminder content notifies the user and does NOT launch YouTube", async () => {
    const dueTime = Date.now() - 1000;
    const reminderRes = await createReminder({
      title: "open YouTube",
      scheduledAt: dueTime,
      channel: "test_notify_9",
    });

    await tick(Date.now());

    // 1. Notification was delivered
    expect(deliveredNotifications.length).toBe(1);
    expect(deliveredNotifications[0].body).toContain("open YouTube");

    // 2. Schedule job step was only 'system.notify'
    const job = getSchedule(reminderRes.reminder!.id);
    expect(job?.workflowTemplate?.steps[0].input.toolId).toBe("system.notify");
  });

  it("10. Reminder title extraction does not retain unnecessary trailing 'and'", () => {
    const cmd1 = parseReminderCommand("set reminder about open youtube and about 5:29 pm") as any;
    expect(cmd1?.kind).toBe("reminder");
    expect(cmd1?.title).toBe("open YouTube");
    expect(cmd1?.timeInput).toBe("5:29 pm");

    const cmd2 = parseReminderCommand("remind me to open youtube and at 6:00 pm") as any;
    expect(cmd2?.title).toBe("open YouTube");
    expect(cmd2?.timeInput).toBe("6:00 pm");

    const pendingCleaned = cleanPendingReminderContent("open youtube and");
    expect(pendingCleaned).toBe("open YouTube");
  });

  it("11. Reminder title extraction preserves legitimate internal conjunctions", () => {
    const cmd1 = parseReminderCommand("remind me to study math and science at 5pm") as any;
    expect(cmd1?.title).toBe("study math and science");
    expect(cmd1?.timeInput).toBe("5pm");

    const cmd2 = parseReminderCommand("remind me to call mom and dad at 8:30 pm") as any;
    expect(cmd2?.title).toBe("call mom and dad");

    const cmd3 = parseReminderCommand("remind me about rock and roll and pop music at 9pm") as any;
    expect(cmd3?.title).toBe("rock and roll and pop music");

    const pendingCleaned = cleanPendingReminderContent("call mom and dad");
    expect(pendingCleaned).toBe("call Mom and dad");
  });

  it("12. In-app listeners receive notifications when active", async () => {
    let inAppReceived: NotificationPayload | null = null;
    const unsubscribe = onInAppNotification((payload) => {
      inAppReceived = payload;
    });

    const dueTime = Date.now() - 1000;
    await createReminder({
      title: "in-app notification test",
      scheduledAt: dueTime,
      channel: "test_notify_12",
    });

    await tick(Date.now());

    expect(inAppReceived).not.toBeNull();
    expect((inAppReceived as any).body).toContain("in-app notification test");

    unsubscribe();
  });

  it("13. Timezone and date rollover remain correct", async () => {
    // When scheduled for 10:52 pm in Asia/Kolkata timezone
    const res = await createReminder({
      title: "timezone test reminder",
      timeInput: "10:52 pm",
      timezone: "Asia/Kolkata",
      channel: "test_notify_13",
    });

    expect(res.success).toBe(true);
    expect(res.reminder).toBeDefined();

    const job = getSchedule(res.reminder!.id);
    expect(job).toBeDefined();
    expect(job?.nextRunAt).toBeGreaterThan(Date.now() - 86400000);

    const formatted = new Date(job!.nextRunAt!).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    expect(formatted.toLowerCase()).toContain("10:52");
  });
});
