// src/orchestrator/hooks.ts

import { WorkflowStartedPayload, WorkflowCompletedPayload, WorkflowFailedPayload, WorkflowCancelledPayload, HookPayload } from './types';

type Callback<T> = (payload: T) => void | Promise<void>;

/** Hook registries */
const startedHooks: Callback<WorkflowStartedPayload>[] = [];
const completedHooks: Callback<WorkflowCompletedPayload>[] = [];
const failedHooks: Callback<WorkflowFailedPayload>[] = [];
const cancelledHooks: Callback<WorkflowCancelledPayload>[] = [];

/** Register callbacks */
export function onWorkflowStarted(cb: Callback<WorkflowStartedPayload>) {
  startedHooks.push(cb);
}
export function onWorkflowCompleted(cb: Callback<WorkflowCompletedPayload>) {
  completedHooks.push(cb);
}
export function onWorkflowFailed(cb: Callback<WorkflowFailedPayload>) {
  failedHooks.push(cb);
}
export function onWorkflowCancelled(cb: Callback<WorkflowCancelledPayload>) {
  cancelledHooks.push(cb);
}

/** Emit functions used by orchestrator */
export async function emitWorkflowStarted(payload: WorkflowStartedPayload) {
  for (const cb of startedHooks) await cb(payload);
}
export async function emitWorkflowCompleted(payload: WorkflowCompletedPayload) {
  for (const cb of completedHooks) await cb(payload);
}
export async function emitWorkflowFailed(payload: WorkflowFailedPayload) {
  for (const cb of failedHooks) await cb(payload);
}
export async function emitWorkflowCancelled(payload: WorkflowCancelledPayload) {
  for (const cb of cancelledHooks) await cb(payload);
}

/** General step hook payload emitter (optional future use) */
export async function emitHook<T extends HookPayload>(payload: T, handlers: Callback<T>[]) {
  for (const cb of handlers) await cb(payload);
}
