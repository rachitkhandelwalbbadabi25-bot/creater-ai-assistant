// ════════════════════════════════════════════════════════════════════════════════
// src/conversation/taskContextStore.ts — Session-Isolated Task & Target Continuity
// Tracks active target identity, completed/pending/failed actions, and recent
// execution plans per (channel:sessionId) without leaking across sessions.
// ════════════════════════════════════════════════════════════════════════════════

import { createLogger } from "@utils/logger.js";
import type { PlannedAction, SharedTargetContext, UniversalExecutionPlan } from "../orchestration/universalPlan.js";

const log = createLogger("conversation/taskContextStore");

export interface SessionTaskContext {
  sessionKey: string;
  activeTarget?: SharedTargetContext;
  lastPlan?: UniversalExecutionPlan;
  completedActions: PlannedAction[];
  pendingActions: PlannedAction[];
  failedActions: PlannedAction[];
  updatedAt: number;
}

const CONTEXT_TTL_MS = 30 * 60 * 1000;
const store = new Map<string, SessionTaskContext>();

export function buildSessionKey(channel: string = "tui", sessionId?: string): string {
  return sessionId ? `${channel}:${sessionId}` : channel;
}

export function getTaskContext(channel: string = "tui", sessionId?: string): SessionTaskContext | undefined {
  const key = buildSessionKey(channel, sessionId);
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.updatedAt > CONTEXT_TTL_MS) {
    store.delete(key);
    return undefined;
  }
  return entry;
}

export function setActiveTarget(
  channel: string = "tui",
  target: SharedTargetContext,
  sessionId?: string
): SessionTaskContext {
  const key = buildSessionKey(channel, sessionId);
  const existing = getTaskContext(channel, sessionId) ?? {
    sessionKey: key,
    completedActions: [],
    pendingActions: [],
    failedActions: [],
    updatedAt: Date.now(),
  };
  const updated: SessionTaskContext = {
    ...existing,
    activeTarget: { ...existing.activeTarget, ...target },
    updatedAt: Date.now(),
  };
  store.set(key, updated);
  log.info("Updated active target context", { sessionKey: key, targetType: target.targetType, title: target.title });
  return updated;
}

export function recordPlanExecution(
  channel: string = "tui",
  plan: UniversalExecutionPlan,
  sessionId?: string
): SessionTaskContext {
  const key = buildSessionKey(channel, sessionId);
  const updated: SessionTaskContext = {
    sessionKey: key,
    activeTarget: plan.sharedContext,
    lastPlan: plan,
    completedActions: plan.actions.filter((a) => a.status === "completed"),
    pendingActions: plan.actions.filter((a) => a.status === "pending" || a.status === "awaiting_approval"),
    failedActions: plan.actions.filter((a) => a.status === "failed" || a.status === "verification_failed"),
    updatedAt: Date.now(),
  };
  store.set(key, updated);
  return updated;
}

export function clearTaskContext(channel: string = "tui", sessionId?: string): void {
  const key = buildSessionKey(channel, sessionId);
  store.delete(key);
}
