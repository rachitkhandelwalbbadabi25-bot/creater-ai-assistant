// src/orchestrator/status.ts

import { createTask, updateTask, getTask, TaskState } from './stateStore';
import { WorkflowStatus } from './types';

/**
 * Create a new workflow entry in the StateStore with initial status.
 */
export function initWorkflow(taskId: string, correlationId: string): void {
  const now = new Date().toISOString();
  const task: Partial<TaskState> = {
    taskId,
    status: 'queued',
    steps: [],
    outputs: [],
    artifacts: [],
    errors: [],
    createdAt: now,
    updatedAt: now,
    metadata: { correlationId },
  } as any;
  // Directly set in store via createTask (partial will merge)
  createTask(taskId, task as any);
}

/** Update workflow status */
export function setWorkflowStatus(taskId: string, status: WorkflowStatus): void {
  updateTask(taskId, (state) => ({ ...state, status } as any));
}

/** Retrieve current status */
export function getWorkflowStatus(taskId: string): WorkflowStatus | undefined {
  const task = getTask(taskId);
  return task?.status as WorkflowStatus | undefined;
}

/** Add step result to workflow */
export function appendStepResult(taskId: string, stepResult: any): void {
  updateTask(taskId, (state) => {
    const steps = Array.isArray(state.steps) ? state.steps : [];
    steps.push(stepResult);
    return { ...state, steps } as any;
  });
}

/** Append artifacts */
export function appendArtifacts(taskId: string, artifacts: any[]): void {
  updateTask(taskId, (state) => {
    const existing = Array.isArray(state.artifacts) ? state.artifacts : [];
    return { ...state, artifacts: existing.concat(artifacts) } as any;
  });
}
