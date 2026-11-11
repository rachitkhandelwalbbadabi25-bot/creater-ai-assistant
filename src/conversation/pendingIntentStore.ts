// ════════════════════════════════════════════════════════════════════════════════
// src/conversation/pendingIntentStore.ts — Generic Pending Intent & Clarification Store
// ════════════════════════════════════════════════════════════════════════════════

import { createLogger } from "@utils/logger.js";

const log = createLogger("conversation/pendingIntentStore");

export interface PendingReminderIntent {
  intent: "REMINDER_CREATION";
  requiredField: "CONTENT" | "TIME";
  collectedFields: {
    title?: string;
    timeInput?: string;
    scheduledAt?: string | number;
    [key: string]: unknown;
  };
  createdAt: number;
}

export type PendingIntent = PendingReminderIntent;

const store = new Map<string, PendingIntent>();

/** Max age for a pending intent before it automatically expires (5 minutes) */
const PENDING_INTENT_TTL_MS = 5 * 60 * 1000;

export function setPendingIntent(channel: string = "tui", pending: PendingIntent): void {
  store.set(channel, pending);
  log.info("Set pending intent", { channel, intent: pending.intent, fields: pending.collectedFields });
}

export function getPendingIntent(channel: string = "tui"): PendingIntent | undefined {
  const pending = store.get(channel);
  if (!pending) return undefined;

  // Expire if older than TTL
  if (Date.now() - pending.createdAt > PENDING_INTENT_TTL_MS) {
    store.delete(channel);
    log.info("Expired pending intent", { channel, intent: pending.intent });
    return undefined;
  }

  return pending;
}

export function clearPendingIntent(channel: string = "tui"): void {
  if (store.has(channel)) {
    store.delete(channel);
    log.info("Cleared pending intent", { channel });
  }
}

export function hasPendingIntent(channel: string = "tui"): boolean {
  return getPendingIntent(channel) !== undefined;
}

export function isExplicitCancellation(input: string): boolean {
  const normalized = input.trim().toLowerCase().replace(/[!?.,]+$/g, "");
  return /^(cancel|cancel that|cancel reminder|never mind|nevermind|forget it|forget that|nvm|stop|no thanks|don't|dont|no)$/i.test(normalized);
}

export function isExplicitCommandOverride(input: string): boolean {
  const raw = input.trim();
  const lower = raw.toLowerCase();

  // If the user explicitly starts with "to ", it is an infinitive answer to "What should I remind you about?"
  if (/^to\s+/i.test(raw)) {
    return false;
  }

  // Explicit cancellation is handled separately before override
  if (isExplicitCancellation(raw)) {
    return false;
  }

  // Check if it's a new reminder command (e.g. "set a reminder for 9 pm to call mom")
  if (/\b(set|create|add)\s+(a\s+|another\s+)?reminder\b/i.test(raw) || /^(remind me|remind)\b/i.test(raw)) {
    return true;
  }

  // Check if it's a direct open/launch command (e.g. "open youtube", "open chrome", "open notepad", "open downloads")
  if (/^(open|launch|start|run|go to)\s+/i.test(lower)) {
    return true;
  }

  // Check volume/system commands
  if (/^(volume up|volume down|mute|unmute|shutdown|restart)\b/i.test(lower)) {
    return true;
  }

  return false;
}

export function cleanPendingReminderContent(input: string): string {
  let cleaned = input.trim();
  cleaned = cleaned.replace(/[!?.,]+$/g, "").trim();

  // Repeatedly strip leading and trailing prepositions, conjunctions, and connective noise
  let prevCleaned = "";
  while (cleaned !== prevCleaned) {
    prevCleaned = cleaned;
    cleaned = cleaned
      .replace(/^\s*(?:to|that|for|at|about|and|then)\s+/i, "")
      .replace(/\s+(?:to|that|for|at|about|and|then|or|also)\s*$/i, "")
      .trim();
  }

  // Normalize separators: e.g. "on whatsapp -hello bro" -> "on WhatsApp: hello bro"
  cleaned = cleaned.replace(/(\b(?:on\s+(?:whatapp|whatsapp|watsapp)|to\s+[a-zA-Z0-9_]+|[a-zA-Z0-9_]+))\s*[-–—]\s*(.+)$/i, "$1: $2");

  // Correct obvious brand/app spelling errors
  cleaned = cleaned.replace(/\b(?:whatapp|whatsapp|watsapp)\b/gi, "WhatsApp");
  cleaned = cleaned.replace(/\byoutube\b/gi, "YouTube");
  cleaned = cleaned.replace(/\bchrome\b/gi, "Chrome");
  cleaned = cleaned.replace(/\bpython\b/gi, "Python");

  // Capitalize recipient name after message/call/text/ping/tell if not a generic word
  cleaned = cleaned.replace(/\b(message|call|text|ping|tell)\s+([a-zA-Z0-9_]+)\b/gi, (match, verb, target) => {
    const lower = target.toLowerCase();
    const commonNonNames = new Set(["a", "an", "the", "me", "him", "her", "them", "someone", "everyone", "my", "our", "all"]);
    if (commonNonNames.has(lower)) {
      return match;
    }
    const capitalizedTarget = target.charAt(0).toUpperCase() + target.slice(1);
    return `${verb} ${capitalizedTarget}`;
  });

  return cleaned;
}
