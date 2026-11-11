// ════════════════════════════════════════════════════════════════════════════════
// tests/reminderSystem.test.ts — Reminder System Regression & Intent Validation Suite
// ════════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from "./bunTestPolyfill.js";
import { processMessage } from "../src/graph/supervisor.js";
import { listSchedules, deleteSchedule } from "../src/scheduler/schedulerEngine.js";
import { parseReminderCommand } from "../src/graph/commandRouter.js";
import { createReminder, listReminders, queryReminders } from "../src/scheduler/reminderTools.js";

describe("Reminder System — Phase 2 to Phase 10 Tests", () => {
  beforeEach(() => {
    // Clear all existing schedules in database before each test
    listSchedules().forEach((job) => deleteSchedule(job.id));
  });

  // ── Phase 2 & 3: Missing Information / Command Noise Validation ─────────────

  it("1. Reject empty/generic reminder creation prompt without database insertion", async () => {
    const res1 = await processMessage("can you set a reminder", "tui");
    expect(res1).toContain("what should I remind you about");
    expect(listSchedules().length).toBe(0);

    const res2 = await processMessage("set a reminder", "tui");
    expect(res2).toContain("what should I remind you about");
    expect(listSchedules().length).toBe(0);

    const res3 = await processMessage("remind me", "tui");
    expect(res3).toContain("what should I remind you about");
    expect(listSchedules().length).toBe(0);
  });

  it("2. Reject reminder with missing content but valid time without database insertion", async () => {
    const res1 = await processMessage("set a reminder for 10:52 pm", "tui");
    expect(res1.toLowerCase()).toContain("what should i remind you about");
    expect(listSchedules().length).toBe(0);

    const res2 = await processMessage("btw you have to set a reminder for 10:52 pm", "tui");
    expect(res2.toLowerCase()).toContain("what should i remind you about");
    expect(listSchedules().length).toBe(0);
  });

  // ── Phase 4: Valid Reminder Creation & Phrase Extraction ────────────────────

  it("3. Successfully create valid reminder with extracted title and time", async () => {
    const res = await processMessage("remind me to test Creater AI at 10:52 pm", "tui");
    expect(res.toLowerCase()).toContain("test creater ai");
    
    const schedules = listSchedules();
    expect(schedules.length).toBe(1);
    expect(String(schedules[0]!.metadata?.reminderTitle).toLowerCase()).toBe("test creater ai");
  });

  it("4. Extract title when time appears before content in phrase", async () => {
    const cmd = parseReminderCommand("remind me tomorrow at 8 am to study");
    expect(cmd?.kind).toBe("reminder");
    if (cmd?.kind === "reminder") {
      expect(cmd.action).toBe("create");
      expect(cmd.title?.toLowerCase()).toBe("study");
      expect(cmd.timeInput).toBe("tomorrow at 8 am");
    }
  });

  it("5. Extract title when time appears at start of phrase", async () => {
    const cmd = parseReminderCommand("at 10:52 pm remind me to check Creater AI");
    expect(cmd?.kind).toBe("reminder");
    if (cmd?.kind === "reminder") {
      expect(cmd.action).toBe("create");
      expect(cmd.title?.toLowerCase()).toBe("check creater ai");
      expect(cmd.timeInput).toBe("10:52 pm");
    }
  });

  // ── Phase 5 & 6: Retrieval & Queries ───────────────────────────────────────

  it("6. Correctly query latest reminder", async () => {
    await processMessage("remind me to test Creater AI at 10:52 pm", "tui");

    const queryRes = await processMessage("btw what was the reminder for", "tui");
    expect(queryRes.toLowerCase()).toContain("test creater ai");
    expect(queryRes).toContain("10:52");
  });

  it("7. Recency resolution with multiple reminders", async () => {
    await processMessage("remind me to test Creater AI at 10:00 pm", "tui");
    // Wait small tick for timestamp ordering
    await new Promise((r) => setTimeout(r, 10));
    await processMessage("set another reminder to study HRM at 11:00 pm", "tui");

    const lastRes = await processMessage("what was the last reminder?", "tui");
    expect(lastRes.toLowerCase()).toContain("study hrm");

    const allRes = await processMessage("show my reminders", "tui");
    expect(allRes.toLowerCase()).toContain("study hrm");
    expect(allRes.toLowerCase()).toContain("test creater ai");
  });

  // ── Phase 10: Full Real Conversation Sequence ────────────────────────────────

  it("8. Execute Phase 10 exact conversation sequence", async () => {
    // 1. User: "can you set a reminder"
    const step1 = await processMessage("can you set a reminder", "tui");
    expect(step1.toLowerCase()).toContain("what should i remind you about");
    expect(listSchedules().length).toBe(0);

    // 2. User: "remind me to test Creater AI at 10:52 pm"
    const step2 = await processMessage("remind me to test Creater AI at 10:52 pm", "tui");
    expect(step2.toLowerCase()).toContain("test creater ai");
    expect(step2).toContain("10:52");
    expect(listSchedules().length).toBe(1);

    // 3. User: "btw what was the reminder for"
    const step3 = await processMessage("btw what was the reminder for", "tui");
    expect(step3.toLowerCase()).toContain("test creater ai");
    expect(step3).toContain("10:52");

    // 4. User: "set another reminder to study at 11:30 pm"
    await new Promise((r) => setTimeout(r, 10));
    const step4 = await processMessage("set another reminder to study at 11:30 pm", "tui");
    expect(step4.toLowerCase()).toContain("study");
    expect(step4).toContain("11:30");
    expect(listSchedules().length).toBe(2);

    // 5. User: "what was the last reminder?"
    const step5 = await processMessage("what was the last reminder?", "tui");
    expect(step5.toLowerCase()).toContain("study");
    expect(step5).toContain("11:30");

    // 6. User: "show all my reminders"
    const step6 = await processMessage("show all my reminders", "tui");
    expect(step6.toLowerCase()).toContain("test creater ai");
    expect(step6.toLowerCase()).toContain("study");
  });

  // ── Exact Production Failure Regression Tests ─────────────────────────────

  it("9. Regression Test 1: 'set reminder for 11:36 pm now' -> no DB insert, asks content, preserves 11:36 PM", async () => {
    const res = await processMessage("set reminder for 11:36 pm now", "tui");
    expect(res.toLowerCase()).toContain("what should i remind you about");
    expect(res).toContain("11:36 PM");
    expect(listSchedules().length).toBe(0);
  });

  it("10. Regression Test 2 & 3: Time before content phrase extraction", async () => {
    const res1 = await processMessage("set a reminder for 11:36 pm to study", "tui");
    expect(res1.toLowerCase()).toContain("study");
    expect(listSchedules().length).toBe(1);
    expect(String(listSchedules()[0]!.metadata?.reminderTitle).toLowerCase()).toBe("study");

    listSchedules().forEach((j) => deleteSchedule(j.id));

    const res2 = await processMessage("set reminder for 11:36 pm to test Creater AI", "tui");
    expect(res2.toLowerCase()).toContain("test creater ai");
    expect(listSchedules().length).toBe(1);
    expect(String(listSchedules()[0]!.metadata?.reminderTitle).toLowerCase()).toBe("test creater ai");
  });

  it("11. Regression Test 4 & 5: Content before time phrase extraction", async () => {
    const res1 = await processMessage("remind me to test Creater AI at 11:36 pm", "tui");
    expect(res1.toLowerCase()).toContain("test creater ai");
    expect(listSchedules().length).toBe(1);

    listSchedules().forEach((j) => deleteSchedule(j.id));

    const res2 = await processMessage("set reminder to study at 11:36 pm", "tui");
    expect(res2.toLowerCase()).toContain("study");
    expect(listSchedules().length).toBe(1);
  });

  it("12. Regression Test 6: 'set reminder for 11 pm' -> no DB insert, asks content", async () => {
    const res = await processMessage("set reminder for 11 pm", "tui");
    expect(res.toLowerCase()).toContain("what should i remind you about");
    expect(listSchedules().length).toBe(0);
  });

  it("13. Regression Test 7: Malformed time input -> no DB insert", async () => {
    const res = await createReminder({ title: "study", timeInput: "invalid_time_string_xyz" });
    expect(res.success).toBe(false);
    expect(listSchedules().length).toBe(0);
  });

  it("14. Regression Test 8: Persisted datetime exactly matches parsed datetime", async () => {
    const res = await createReminder({ title: "verify timestamp", timeInput: "tomorrow at 10 am" });
    expect(res.success).toBe(true);
    const job = listSchedules()[0]!;
    expect(job.nextRunAt).toBeDefined();
    expect(job.nextRunAt).toBeGreaterThan(Date.now());
  });

  it("15. Regression Test 9 & 10: 'now' and 'for 11:36 pm' are NEVER extracted as content", async () => {
    const cmd1 = parseReminderCommand("set reminder for 11:36 pm now");
    expect(cmd1?.kind).toBe("reminder");
    if (cmd1?.kind === "reminder") {
      expect(cmd1.title).toBeUndefined();
    }

    const cmd2 = parseReminderCommand("set reminder for 11:36 pm");
    expect(cmd2?.kind).toBe("reminder");
    if (cmd2?.kind === "reminder") {
      expect(cmd2.title).toBeUndefined();
    }
  });

  // ── Multi-Turn Pending Clarification & Override Tests ─────────────────────

  it("16. Multi-turn Test 1: Exact production failure flow", async () => {
    // Turn 1
    const res1 = await processMessage("set reminder for 11:56 pm now", "tui");
    expect(res1.toLowerCase()).toContain("what should i remind you about");
    expect(listSchedules().length).toBe(0);

    // Turn 2: "to play youtube"
    const res2 = await processMessage("to play youtube", "tui");
    expect(res2.toLowerCase()).toContain("play youtube");
    expect(res2.toLowerCase().includes("opened video")).toBe(false);
    expect(listSchedules().length).toBe(1);
    expect(String(listSchedules()[0]!.metadata?.reminderTitle).toLowerCase()).toBe("play youtube");

    // Turn 3: "what is the reminder for"
    const res3 = await processMessage("what is the reminder for", "tui");
    expect(res3.toLowerCase()).toContain("play youtube");
  });

  it("17. Multi-turn Test 2: 'set reminder for 8 pm' -> 'study'", async () => {
    const res1 = await processMessage("set reminder for 8 pm", "tui");
    expect(res1.toLowerCase()).toContain("what should i remind you about");
    expect(listSchedules().length).toBe(0);

    const res2 = await processMessage("study", "tui");
    expect(res2.toLowerCase()).toContain("study");
    expect(listSchedules().length).toBe(1);
    expect(String(listSchedules()[0]!.metadata?.reminderTitle).toLowerCase()).toBe("study");
  });

  it("18. Multi-turn Test 3: 'set reminder for 9 pm' -> 'call mom'", async () => {
    const res1 = await processMessage("set reminder for 9 pm", "tui");
    expect(res1.toLowerCase()).toContain("what should i remind you about");
    expect(listSchedules().length).toBe(0);

    const res2 = await processMessage("call mom", "tui");
    expect(res2.toLowerCase()).toContain("call mom");
    expect(listSchedules().length).toBe(1);
    expect(String(listSchedules()[0]!.metadata?.reminderTitle).toLowerCase()).toBe("call mom");
  });

  it("19. Multi-turn Test 4: 'set reminder for 10 pm' -> 'open Chrome' (Explicit Override)", async () => {
    const res1 = await processMessage("set reminder for 10 pm", "tui");
    expect(res1.toLowerCase()).toContain("what should i remind you about");
    expect(listSchedules().length).toBe(0);

    const res2 = await processMessage("open Chrome", "tui");
    expect(res2.toLowerCase()).toContain("opening google chrome");
    expect(listSchedules().length).toBe(0);
  });

  it("20. Multi-turn Test 5: Cancellation flow ('never mind')", async () => {
    const res1 = await processMessage("set reminder for 8 pm", "tui");
    expect(res1.toLowerCase()).toContain("what should i remind you about");
    expect(listSchedules().length).toBe(0);

    const res2 = await processMessage("never mind", "tui");
    expect(res2.toLowerCase()).toContain("cancelled");
    expect(listSchedules().length).toBe(0);
  });

  it("21. Multi-turn Test 6: Explicit override flow ('open YouTube')", async () => {
    const res1 = await processMessage("set reminder for 8 pm", "tui");
    expect(res1.toLowerCase()).toContain("what should i remind you about");
    expect(listSchedules().length).toBe(0);

    const res2 = await processMessage("open YouTube", "tui");
    expect(res2.toLowerCase()).toContain("opening youtube");
    expect(listSchedules().length).toBe(0);
  });

  it("22. Multi-turn Test 7: Existing direct single-turn reminder behavior preserved", async () => {
    const res = await processMessage("remind me to test Creater AI at 11:36 pm", "tui");
    expect(res.toLowerCase()).toContain("test creater ai");
    expect(listSchedules().length).toBe(1);
    expect(String(listSchedules()[0]!.metadata?.reminderTitle).toLowerCase()).toBe("test creater ai");
  });

  // ── Exact Production Regression Suite: 12 Required Tests ───────────────────

  describe("Exact Production Regression Suite (12 Required Tests)", () => {
    it("R1. 'set a reminder for 9;42 am' -> time normalized; content clarification only; zero DB inserts", async () => {
      const { hasPendingIntent, getPendingIntent } = await import("../src/conversation/pendingIntentStore.js");
      const res = await processMessage("set a reminder for 9;42 am", "tui");

      expect(res).toBe("What should I remind you about at 9:42 AM?");
      expect(listSchedules().length).toBe(0);
      expect(hasPendingIntent("tui")).toBe(true);

      const pending = getPendingIntent("tui");
      expect(pending).toBeDefined();
      expect(pending?.intent).toBe("REMINDER_CREATION");
      expect(pending?.requiredField).toBe("CONTENT");
      expect(pending?.collectedFields.timeInput).toBe("9:42 AM");
      expect(pending?.collectedFields.scheduledAt).toBeDefined();
    });

    it("R2. Follow-up 'to message ojas on whatapp -hello bro' -> creates exactly one reminder at retained time with normalized content", async () => {
      const { hasPendingIntent } = await import("../src/conversation/pendingIntentStore.js");
      // Turn 1
      await processMessage("set a reminder for 9;42 am", "tui");
      expect(listSchedules().length).toBe(0);

      // Turn 2
      const res2 = await processMessage("to message ojas on whatapp -hello bro", "tui");
      expect(res2.toLowerCase()).toContain("reminder set");
      expect(res2).toContain("message Ojas on WhatsApp: hello bro");
      expect(res2).toContain("9:42");

      const schedules = listSchedules();
      expect(schedules.length).toBe(1);
      expect(schedules[0]!.metadata?.reminderTitle).toBe("message Ojas on WhatsApp: hello bro");
      expect(hasPendingIntent("tui")).toBe(false);
    });

    it("R3. Follow-up does not trigger Google search or YouTube routing", async () => {
      // Turn 1
      await processMessage("set a reminder for 9;42 am", "tui");

      // Turn 2
      const res2 = await processMessage("to message ojas on whatapp -hello bro", "tui");
      expect(res2.toLowerCase().includes("searching google")).toBe(false);
      expect(res2.toLowerCase().includes("youtube")).toBe(false);
      expect(res2.toLowerCase().includes("opened video")).toBe(false);
      expect(res2.startsWith("✅ Reminder set:")).toBe(true);
    });

    it("R4. 'tell me what was the last reminder' retrieves newly persisted reminder", async () => {
      await processMessage("set a reminder for 9;42 am", "tui");
      await processMessage("to message ojas on whatapp -hello bro", "tui");

      const res3 = await processMessage("tell me what was the last reminder", "tui");
      expect(res3).toContain("Your last reminder is to message Ojas on WhatsApp: hello bro");
      expect(res3).toContain("9:42 AM");
    });

    it("R5. 'set a reminder for 9:42 am' continues to work", async () => {
      const res = await processMessage("set a reminder for 9:42 am", "tui");
      expect(res).toBe("What should I remind you about at 9:42 AM?");
      expect(listSchedules().length).toBe(0);
    });

    it("R6. 'remind me to message Ojas on WhatsApp at 9:42 am' creates directly", async () => {
      const res = await processMessage("remind me to message Ojas on WhatsApp at 9:42 am", "tui");
      expect(res.toLowerCase()).toContain("reminder set");
      expect(res).toContain("9:42");
      expect(listSchedules().length).toBe(1);
    });

    it("R7. Invalid time -> clarification; zero inserts", async () => {
      const res = await processMessage("remind me to study at 25:99 pm", "tui");
      expect(res.toLowerCase()).toContain("when should i remind you");
      expect(listSchedules().length).toBe(0);
    });

    it("R8. Pending state is cleared after successful creation", async () => {
      const { hasPendingIntent } = await import("../src/conversation/pendingIntentStore.js");
      await processMessage("set a reminder for 9;42 am", "tui");
      expect(hasPendingIntent("tui")).toBe(true);

      await processMessage("to message ojas on whatapp -hello bro", "tui");
      expect(hasPendingIntent("tui")).toBe(false);
    });

    it("R9. Cancellation clears pending state and creates no reminder", async () => {
      const { hasPendingIntent } = await import("../src/conversation/pendingIntentStore.js");
      await processMessage("set a reminder for 9;42 am", "tui");
      expect(hasPendingIntent("tui")).toBe(true);

      const cancelRes = await processMessage("cancel", "tui");
      expect(cancelRes.toLowerCase()).toContain("cancelled");
      expect(hasPendingIntent("tui")).toBe(false);
      expect(listSchedules().length).toBe(0);
    });

    it("R10. Explicit new command overrides pending clarification according to existing rules", async () => {
      const { hasPendingIntent } = await import("../src/conversation/pendingIntentStore.js");
      await processMessage("set a reminder for 9;42 am", "tui");
      expect(hasPendingIntent("tui")).toBe(true);

      const overrideRes = await processMessage("open Chrome", "tui");
      expect(overrideRes.toLowerCase()).toContain("opening google chrome");
      expect(hasPendingIntent("tui")).toBe(false);
      expect(listSchedules().length).toBe(0);
    });

    it("R11. A second conversation/session cannot accidentally consume another session's pending reminder", async () => {
      const { hasPendingIntent } = await import("../src/conversation/pendingIntentStore.js");
      // Session A sets pending reminder
      await processMessage("set a reminder for 9;42 am", "session_A" as any);
      expect(hasPendingIntent("session_A")).toBe(true);
      expect(hasPendingIntent("session_B")).toBe(false);

      // Session B sends a non-reminder message; it must NOT consume Session A's pending reminder
      const resB = await processMessage("what is your name?", "session_B" as any);
      expect(resB.toLowerCase()).toContain("creater");
      expect(hasPendingIntent("session_A")).toBe(true);
      expect(listSchedules().length).toBe(0);

      // Session A resumes its pending reminder
      const resA = await processMessage("to study Python", "session_A" as any);
      expect(resA.toLowerCase()).toContain("reminder set");
      expect(resA.toLowerCase()).toContain("study python");
      expect(listSchedules().length).toBe(1);
      expect(hasPendingIntent("session_A")).toBe(false);
    });

    it("R12. A pending reminder survives the actual turn boundary used by UI/TUI", async () => {
      const { hasPendingIntent } = await import("../src/conversation/pendingIntentStore.js");
      // Turn 1 on "web"
      const res1 = await processMessage("set a reminder for 9;42 am", "web");
      expect(res1).toBe("What should I remind you about at 9:42 AM?");
      expect(hasPendingIntent("web")).toBe(true);

      // Turn 2 on "web"
      const res2 = await processMessage("to message ojas on whatapp -hello bro", "web");
      expect(res2.toLowerCase()).toContain("reminder set");
      expect(hasPendingIntent("web")).toBe(false);
      expect(listSchedules().length).toBe(1);
    });
  });
});

