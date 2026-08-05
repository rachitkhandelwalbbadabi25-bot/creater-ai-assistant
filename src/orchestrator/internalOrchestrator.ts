// src/orchestrator/internalOrchestrator.ts

import { WorkflowDefinition, WorkflowResult } from './types.js';
import { initWorkflow, getWorkflowStatus as getStatus } from './status.js';
import { runWorkflow, cancelWorkflow as cancelInTaskRunner } from './taskRunner.js';
import { globalQueueManager } from './queueManager.js';
import { getOrchestratorHealth } from './health.js';

/**
 * Execute a workflow definition.
 * The workflow is queued respecting the global concurrency limit.
 * A correlationId is generated for tracing and stored in the task metadata.
 */
export async function executeWorkflow(
  workflow: WorkflowDefinition
): Promise<WorkflowResult> {
  const correlationId = crypto.randomUUID();
  // Initialise task entry in the state store with queued status and correlation id
  initWorkflow(workflow.taskId, correlationId);

  // Enqueue the actual execution. The queue manager tracks the taskId for health reporting.
  return globalQueueManager.enqueue(() => runWorkflow(workflow), workflow.taskId);
}

/** Cancel a running or queued workflow */
export async function cancelWorkflow(taskId: string): Promise<void> {
  // Add to the cancellation registry – taskRunner steps observe this set.
  await cancelInTaskRunner(taskId);
}

/** Retrieve current workflow status */
export function getWorkflowStatus(taskId: string) {
  return getStatus(taskId);
}

/** List IDs of active (running) workflows */
export function getActiveWorkflows(): string[] {
  return globalQueueManager.getActiveTaskIds();
}

/** List IDs of queued workflows */
export function getQueuedWorkflows(): string[] {
  return globalQueueManager.getQueuedTaskIds();
}

/** Expose orchestrator health snapshot */
export { getOrchestratorHealth } from './health.js';
