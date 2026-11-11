// ════════════════════════════════════════════════════════════════════════════════
// src/scheduler/reminderTools.ts — Deterministic Reminder Manager
// Handles date/time parsing, timezone awareness, persistence & validation
// ════════════════════════════════════════════════════════════════════════════════

import { createSchedule, listSchedules, cancelSchedule, deleteSchedule } from "./schedulerEngine.js";
import { createLogger } from "@utils/logger.js";
import { env } from "@config/index.js";

const log = createLogger("scheduler/reminderTools");

export interface ReminderParams {
  title?: string;
  timeInput?: string;
  scheduledAt?: string | number;
  timezone?: string;
  channel?: string;
}

export interface ReminderResult {
  success: boolean;
  action: "create" | "list" | "cancel";
  reminder?: {
    id: string;
    title: string;
    scheduledAt: string;
    timezone: string;
  };
  reminders?: Array<{
    id: string;
    title: string;
    scheduledAt: string;
    status: string;
  }>;
  message: string;
  error?: string;
}

const GENERIC_TITLES = new Set([
  "set a reminder",
  "set reminder",
  "remind me",
  "can you set a reminder",
  "can you remind me",
  "you have to set a reminder",
  "please set a reminder",
  "please remind me",
  "reminder",
  "a reminder",
  "another reminder",
  "set another reminder",
  "btw set a reminder",
  "btw you have to set a reminder",
  "set a reminder for",
  "set reminder for",
  "remind me for",
  "remind me to",
  "create a reminder",
  "create reminder",
  "add a reminder",
  "add reminder",
  "now",
  "right now",
  "today",
  "tomorrow",
  "ok",
  "okay",
]);

const NOISE_AND_FILLER_WORDS = new Set([
  "now",
  "right now",
  "today",
  "tomorrow",
  "ok",
  "okay",
  "for",
  "at",
  "on",
  "in",
  "to",
  "that",
  "about",
  "set",
  "a",
  "another",
  "reminder",
  "remind",
  "me",
  "please",
  "kindly",
  "can",
  "you",
  "could",
  "bro",
  "yaar",
  "btw",
  "have",
]);

export function isGenericTitle(title?: string): boolean {
  if (!title || typeof title !== "string") return true;
  const cleaned = title.trim().toLowerCase();
  if (cleaned.length <= 1) return true;
  if (GENERIC_TITLES.has(cleaned)) return true;

  const wordTokens = cleaned
    .replace(/["'`;:,.\-!]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (wordTokens.length === 0) return true;

  const allNoise = wordTokens.every((w) => {
    if (NOISE_AND_FILLER_WORDS.has(w)) return true;
    if (GENERIC_TITLES.has(w)) return true;
    if (/^\d+(:\d+)?$/.test(w)) return true;
    if (/^(am|pm)$/i.test(w)) return true;
    return false;
  });

  return allNoise;
}

function getTimestampInTimezone(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string
): number {
  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const invDate = new Date(utcDate.toLocaleString("en-US", { timeZone: "UTC" }));
  const targetDate = new Date(utcDate.toLocaleString("en-US", { timeZone }));
  const diff = targetDate.getTime() - invDate.getTime();
  return utcDate.getTime() - diff;
}

/**
 * Parses user natural language time expressions deterministically into a future timestamp (ms).
 */
export function parseReminderTime(
  timeInput: string,
  now: Date = new Date(),
  timezone: string = env.USER_TIMEZONE || "Asia/Kolkata"
): number | null {
  if (!timeInput || typeof timeInput !== "string") return null;
  const text = timeInput.trim().toLowerCase();
  const baseTime = now.getTime();

  // 1. Relative time: "in X minutes", "in X hours", "in X mins"
  const relativeMatch = text.match(/^in\s+(\d+)\s*(min|minute|mins|minutes|hour|hours|hr|hrs|second|seconds|sec|secs)/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();
    const multiplier = unit.startsWith("h") ? 3600 * 1000 : unit.startsWith("s") ? 1000 : 60 * 1000;
    return baseTime + amount * multiplier;
  }

  // 2. Absolute time matching: e.g. "9 pm", "9:05 pm", "9;42 am", "9.42 am", "21:00", "today 9:05 pm", "tomorrow 8 am"
  let isTomorrow = text.includes("tomorrow");
  let isToday = text.includes("today");

  // Extract time pattern supporting colon, semicolon, and dot separators
  const timeMatch = text.match(/(\d{1,2})(?:[:;.](\d{2}))?\s*(am|pm)?/i);
  if (!timeMatch) return null;

  let hours = parseInt(timeMatch[1], 10);
  const minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
  const ampm = timeMatch[3] ? timeMatch[3].toLowerCase() : null;

  if (hours < 0 || hours > 24 || minutes < 0 || minutes > 59) return null;

  if (ampm === "pm" && hours < 12) {
    hours += 12;
  } else if (ampm === "am" && hours === 12) {
    hours = 0;
  } else if (!ampm && hours === 24) {
    hours = 0;
  }

  const dParts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);

  const partMap: Record<string, number> = {};
  for (const p of dParts) {
    if (p.type !== "literal") partMap[p.type] = parseInt(p.value, 10);
  }
  const year = partMap.year || now.getFullYear();
  const month = partMap.month || now.getMonth() + 1;
  const day = partMap.day || now.getDate();

  let targetMs = getTimestampInTimezone(year, month, isTomorrow ? day + 1 : day, hours, minutes, timezone);

  // If time has already passed today and user didn't explicitly specify "today", assume tomorrow
  if (targetMs <= baseTime && !isToday && !isTomorrow) {
    targetMs = getTimestampInTimezone(year, month, day + 1, hours, minutes, timezone);
  }

  return targetMs;
}

/**
 * Creates a deterministic, persistent reminder with mandatory validation of content and time.
 */
export async function createReminder(params: ReminderParams): Promise<ReminderResult> {
  try {
    const title = params.title ? params.title.trim() : undefined;
    const hasValidTitle = !isGenericTitle(title);
    const timezone = params.timezone || env.USER_TIMEZONE || "Asia/Kolkata";

    let runAtMs: number | null = null;
    if (params.scheduledAt) {
      runAtMs = typeof params.scheduledAt === "number" ? params.scheduledAt : new Date(params.scheduledAt).getTime();
    } else if (params.timeInput) {
      runAtMs = parseReminderTime(params.timeInput, undefined, timezone);
    }

    const hasValidTime = runAtMs !== null && !isNaN(runAtMs) && (params.scheduledAt ? runAtMs > 0 : runAtMs > 0);

    // CASE 1: Both title and time are missing
    if (!hasValidTitle && !hasValidTime) {
      return {
        success: false,
        action: "create",
        message: "Sure — what should I remind you about, and when?",
        error: "Missing title and time",
      };
    }

    // CASE 2: Title is missing, but time is present
    if (!hasValidTitle && hasValidTime) {
      const timeDisplay = new Date(runAtMs!).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: timezone,
      });

      const { setPendingIntent } = await import("../conversation/pendingIntentStore.js");
      setPendingIntent(params.channel || "tui", {
        intent: "REMINDER_CREATION",
        requiredField: "CONTENT",
        collectedFields: {
          timeInput: params.timeInput,
          scheduledAt: runAtMs!,
        },
        createdAt: Date.now(),
      });

      return {
        success: false,
        action: "create",
        message: `What should I remind you about at ${timeDisplay}?`,
        error: "Missing title",
      };
    }

    // CASE 3: Title is present, but time is missing/invalid
    if (hasValidTitle && !hasValidTime) {
      const { setPendingIntent } = await import("../conversation/pendingIntentStore.js");
      setPendingIntent(params.channel || "tui", {
        intent: "REMINDER_CREATION",
        requiredField: "TIME",
        collectedFields: {
          title,
        },
        createdAt: Date.now(),
      });

      return {
        success: false,
        action: "create",
        message: `When should I remind you to ${title}?`,
        error: "Missing time",
      };
    }

    // CASE 4: Both title and time are valid -> Create schedule in database
    const { clearPendingIntent } = await import("../conversation/pendingIntentStore.js");
    clearPendingIntent(params.channel || "tui");

    const scheduledDateStr = new Date(runAtMs!).toLocaleString("en-IN", { timeZone: timezone });
    const timeDisplay = new Date(runAtMs!).toLocaleTimeString("en-IN", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const notificationBody = title!.toLowerCase().startsWith("to ")
      ? `It's time ${title!}.`
      : `It's time to ${title!}.`;

    const job = createSchedule({
      name: `Reminder: ${title}`,
      description: `User reminder: ${title}`,
      schedule: {
        type: "ONCE",
        runAt: runAtMs!,
        missedPolicy: "RUN_ONCE_IF_MISSED",
        timezone,
      },
      workflowTemplate: {
        name: `Notify Reminder: ${title}`,
        steps: [
          {
            id: "notify",
            name: "Display Notification",
            type: "TOOL",
            input: {
              toolId: "system.notify",
              params: {
                title: "Creater AI — Reminder",
                message: notificationBody,
                reminderTitle: title,
                scheduledAt: timeDisplay,
              },
            },
          },
        ],
      },
      metadata: {
        reminderTitle: title,
        timezone,
        createdVia: "reminderTools",
      },
    });

    log.info(`Reminder created successfully: [${job.id}] "${title}" at ${scheduledDateStr}`);

    return {
      success: true,
      action: "create",
      reminder: {
        id: job.id,
        title: title!,
        scheduledAt: scheduledDateStr,
        timezone,
      },
      message: `✅ Reminder set: "${title}" for ${scheduledDateStr}`,
    };
  } catch (err: any) {
    log.error("Failed to create reminder", err);
    return {
      success: false,
      action: "create",
      message: `❌ Failed to set reminder: ${err.message || String(err)}`,
      error: err.message || String(err),
    };
  }
}

/**
 * Lists all active user reminders sorted by creation recency.
 */
export function listReminders(): ReminderResult {
  try {
    const allSchedules = listSchedules();
    const reminders = allSchedules
      .filter((job) => (job.name.startsWith("Reminder:") || job.metadata?.createdVia === "reminderTools") && job.status === "ACTIVE")
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((job) => ({
        id: job.id,
        title: String(job.metadata?.reminderTitle || job.name.replace(/^Reminder:\s*/, "")),
        scheduledAt: job.nextRunAt ? new Date(job.nextRunAt).toLocaleString("en-IN", { timeZone: env.USER_TIMEZONE || "Asia/Kolkata" }) : "N/A",
        status: String(job.status),
      }));

    if (reminders.length === 0) {
      return {
        success: true,
        action: "list",
        reminders: [],
        message: "You have no active reminders.",
      };
    }

    const listStr = reminders.map((r, i) => `${i + 1}. "${r.title}" — ${r.scheduledAt}`).join("\n");
    return {
      success: true,
      action: "list",
      reminders,
      message: `📌 Your active reminders:\n${listStr}`,
    };
  } catch (err: any) {
    return {
      success: false,
      action: "list",
      message: `Failed to list reminders: ${err.message}`,
      error: err.message,
    };
  }
}

/**
 * Resolves the relevant/latest active reminder deterministically based on recency.
 */
export function queryReminders(params: { queryType?: "latest" | "all"; channel?: string } = {}): ReminderResult {
  try {
    const timezone = env.USER_TIMEZONE || "Asia/Kolkata";
    const allSchedules = listSchedules();
    const activeReminders = allSchedules
      .filter((job) => (job.name.startsWith("Reminder:") || job.metadata?.createdVia === "reminderTools") && job.status === "ACTIVE")
      .sort((a, b) => b.createdAt - a.createdAt);

    if (activeReminders.length === 0) {
      return {
        success: true,
        action: "list",
        reminders: [],
        message: "You have no active reminders.",
      };
    }

    const latest = activeReminders[0]!;
    const title = String(latest.metadata?.reminderTitle || latest.name.replace(/^Reminder:\s*/, ""));
    const timeStr = latest.nextRunAt
      ? new Date(latest.nextRunAt).toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
          timeZone: timezone,
        })
      : "N/A";
    const dateStr = latest.nextRunAt
      ? new Date(latest.nextRunAt).toLocaleDateString("en-IN", { timeZone: timezone })
      : "";
    const scheduledAtDisplay = dateStr ? `${timeStr} on ${dateStr}` : timeStr;

    return {
      success: true,
      action: "list",
      reminder: {
        id: latest.id,
        title,
        scheduledAt: scheduledAtDisplay,
        timezone,
      },
      reminders: activeReminders.map((r) => ({
        id: r.id,
        title: String(r.metadata?.reminderTitle || r.name.replace(/^Reminder:\s*/, "")),
        scheduledAt: r.nextRunAt ? new Date(r.nextRunAt).toLocaleString("en-IN", { timeZone: timezone }) : "N/A",
        status: String(r.status),
      })),
      message: `Your last reminder is to ${title}, scheduled for ${scheduledAtDisplay}.`,
    };
  } catch (err: any) {
    return {
      success: false,
      action: "list",
      message: `Failed to query reminders: ${err.message}`,
      error: err.message,
    };
  }
}

/**
 * Cancels a reminder by ID or title query.
 */
export function cancelReminder(query: string): ReminderResult {
  try {
    const allSchedules = listSchedules();
    const target = allSchedules.find(
      (job) =>
        job.id === query ||
        job.name.toLowerCase().includes(query.toLowerCase()) ||
        (job.metadata?.reminderTitle && String(job.metadata.reminderTitle).toLowerCase().includes(query.toLowerCase()))
    );

    if (!target) {
      return {
        success: false,
        action: "cancel",
        message: `No active reminder found matching "${query}".`,
      };
    }

    cancelSchedule(target.id);
    deleteSchedule(target.id);

    const title = target.metadata?.reminderTitle || target.name;
    return {
      success: true,
      action: "cancel",
      message: `🗑️ Cancelled reminder: "${title}".`,
    };
  } catch (err: any) {
    return {
      success: false,
      action: "cancel",
      message: `Failed to cancel reminder: ${err.message}`,
      error: err.message,
    };
  }
}
