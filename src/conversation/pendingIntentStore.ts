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

export type ActionApprovalLifecycleState =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"
  | "modified";

export interface PendingActionApproval {
  intent: "ACTION_APPROVAL";
  actionType: string;
  platform: string;
  target: string;
  targetUrl?: string;
  targetTitle?: string;
  params: Record<string, unknown>;
  approvalState: ActionApprovalLifecycleState;
  expiresAt: number;
  createdAt: number;
  requiredField?: "CONTENT" | "TIME";
  collectedFields?: {
    title?: string;
    timeInput?: string;
    scheduledAt?: string | number;
    [key: string]: unknown;
  };
}

export type PendingIntent = PendingReminderIntent;

const store = new Map<string, PendingIntent>();
const approvalStore = new Map<string, PendingActionApproval>();

/** Max age for a pending intent before it automatically expires (5 minutes) */
const PENDING_INTENT_TTL_MS = 5 * 60 * 1000;

export function setPendingIntent(channel: string = "tui", pending: PendingIntent): void {
  store.set(channel, pending);
  log.info("Set pending intent", { channel, intent: pending.intent, fields: pending.collectedFields });
}

export function getPendingIntent(channel: string = "tui"): PendingIntent | undefined {
  const pending = store.get(channel);
  if (!pending) return undefined;

  if (Date.now() - pending.createdAt > PENDING_INTENT_TTL_MS) {
    store.delete(channel);
    log.info("Expired pending intent", { channel, intent: pending.intent });
    return undefined;
  }

  return pending;
}

function buildApprovalKey(channel: string = "tui", sessionId?: string): string {
  return sessionId ? `${channel}:${sessionId}` : channel;
}

export function setPendingActionApproval(
  channel: string = "tui",
  pending: PendingActionApproval,
  sessionId?: string
): void {
  const key = buildApprovalKey(channel, sessionId);
  approvalStore.set(key, pending);
  log.info("Set pending action approval", { channel: key, actionType: pending.actionType, target: pending.target });
}

export function getPendingActionApproval(channel: string = "tui", sessionId?: string): PendingActionApproval | undefined {
  const key = buildApprovalKey(channel, sessionId);
  const pending = approvalStore.get(key);
  if (!pending) return undefined;
  if (Date.now() > pending.expiresAt) {
    approvalStore.delete(key);
    log.info("Expired pending action approval", { channel: key, actionType: pending.actionType });
    return undefined;
  }
  return pending;
}

export function clearPendingActionApproval(channel: string = "tui", sessionId?: string): void {
  const key = buildApprovalKey(channel, sessionId);
  if (approvalStore.has(key)) {
    approvalStore.delete(key);
    log.info("Cleared pending action approval", { channel: key });
  }
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

export function isExplicitApproval(input: string): boolean {
  const normalized = input.trim().toLowerCase().replace(/[!?.,]+$/g, "");
  return /^(?:yes|yep|yeah|ok|okay|sure|approve|approved|confirm|confirmed|go ahead|post it|send it|submit|do it|haan|ha|kar do|bhej do)$/i.test(
    normalized
  );
}

export function isExplicitRejection(input: string): boolean {
  const normalized = input.trim().toLowerCase().replace(/[!?.,]+$/g, "");
  return /^(?:no|nope|reject|rejected|decline|deny|don'?t send|don'?t post|don'?t comment|mat bhejo|mat karo)$/i.test(
    normalized
  );
}

export function extractApprovalModification(input: string): string | undefined {
  const match = input
    .trim()
    .match(/^(?:change|edit|update|modify)\s+(?:the\s+)?(?:comment|message|text)(?:\s+to)?\s*[:-]?\s*["'“]?(.+?)["'”]?$/i);
  return match && match[1]?.trim() ? match[1].trim() : undefined;
}

export function revalidatePendingApproval(
  pending: PendingActionApproval,
  currentTargetUrl?: string,
  currentParams?: Record<string, unknown>
): { valid: boolean; reason?: string; state: ActionApprovalLifecycleState } {
  if (Date.now() > pending.expiresAt) {
    return { valid: false, reason: "Approval expired.", state: "expired" };
  }
  if (currentTargetUrl && pending.targetUrl && currentTargetUrl !== pending.targetUrl) {
    return {
      valid: false,
      reason: `Target changed from "${pending.targetUrl}" to "${currentTargetUrl}". Renewed approval required.`,
      state: "modified",
    };
  }
  if (
    currentParams?.commentText &&
    pending.params.commentText &&
    String(currentParams.commentText) !== String(pending.params.commentText)
  ) {
    return {
      valid: false,
      reason: "Comment text changed. Renewed approval required.",
      state: "modified",
    };
  }
  if (pending.approvalState !== "approved") {
    return { valid: false, reason: `Approval state is ${pending.approvalState}.`, state: pending.approvalState };
  }
  return { valid: true, state: "approved" };
}

