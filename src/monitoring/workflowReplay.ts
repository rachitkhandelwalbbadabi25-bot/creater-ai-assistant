// ════════════════════════════════════════════════════════════════════════════════
// src/monitoring/workflowReplay.ts — Workflow Replay & State Snapshots (Phase 7)
// Captures immutable step snapshots and provides deterministic replay capabilities.
// ════════════════════════════════════════════════════════════════════════════════

import { createLogger } from "@utils/logger.js";
import { type WorkflowStateSnapshot } from "./types.js";
import { getTask, updateTask } from "../orchestrator/stateStore.js";
import {
  getWorkflow,
  executeAllSteps,
  getOrCreateExecutionContext,
} from "../workflow/workflowEngine.js";
import { type Workflow, type StepStatus, WorkflowError } from "../workflow/types.js";
import { tracer } from "./tracer.js";

const log = createLogger("monitoring/workflowReplay");

class WorkflowReplayManager {
  private snapshots = new Map<string, WorkflowStateSnapshot[]>();

  /** Captures an immutable snapshot of workflow execution context and step results */
  captureSnapshot(
    workflowId: string,
    stepId: string,
    stepIndex: number,
    status: string,
    contextData: Record<string, unknown>,
    stepResults: Record<string, unknown>,
    metadata?: Record<string, unknown>
  ): WorkflowStateSnapshot {
    const snapshotId = `snap_${workflowId}_${stepId}_${Date.now()}`;
    const snapshot: WorkflowStateSnapshot = {
      id: snapshotId,
      workflowId,
      stepId,
      stepIndex,
      timestamp: Date.now(),
      status,
      // Deep clone to ensure immutability
      contextData: JSON.parse(JSON.stringify(contextData || {})),
      stepResults: JSON.parse(JSON.stringify(stepResults || {})),
      metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
    };

    if (!this.snapshots.has(workflowId)) {
      this.snapshots.set(workflowId, []);
    }

    const list = this.snapshots.get(workflowId)!;
    list.push(snapshot);

    log.debug("Captured workflow state snapshot", { workflowId, stepId, snapshotId });
    return snapshot;
  }

  /** Retrieves all snapshots captured for a workflow */
  getSnapshots(workflowId: string): WorkflowStateSnapshot[] {
    return this.snapshots.get(workflowId) || [];
  }

  /** Retrieves the latest snapshot for a workflow */
  getLatestSnapshot(workflowId: string): WorkflowStateSnapshot | undefined {
    const list = this.snapshots.get(workflowId);
    if (!list || list.length === 0) return undefined;
    return list[list.length - 1];
  }

  /**
   * Replays a workflow execution from a specific step or the first failed/interrupted step.
   * Restores contextData and completed predecessor step results, resetting subsequent steps.
   */
  async replayWorkflow(
    workflowId: string,
    options?: {
      fromStepId?: string;
      contextOverrides?: Record<string, unknown>;
    }
  ): Promise<{ success: boolean; workflow: Workflow; replayedFromStep: string }> {
    const workflow = getWorkflow(workflowId);
    if (!workflow) {
      throw new WorkflowError(`Workflow [${workflowId}] not found in stateStore.`, "VALIDATION_ERROR", workflowId);
    }

    const snapshots = this.getSnapshots(workflowId);

    // Identify target step to replay from
    let targetStepId = options?.fromStepId;
    if (!targetStepId) {
      // Find first failed or running step
      const failedStep = workflow.steps.find((s) => s.status === "FAILED" || s.status === "RUNNING");
      targetStepId = failedStep ? failedStep.id : workflow.steps[0]?.id;
    }

    if (!targetStepId) {
      throw new WorkflowError(`Cannot replay workflow [${workflowId}]: no executable steps found.`, "VALIDATION_ERROR", workflowId);
    }

    const targetStepIndex = workflow.steps.findIndex((s) => s.id === targetStepId);
    if (targetStepIndex === -1) {
      throw new WorkflowError(`Step [${targetStepId}] not found in workflow [${workflowId}].`, "VALIDATION_ERROR", workflowId, targetStepId);
    }

    // Start trace for replay
    const trace = tracer.startTrace(`workflow_replay:${workflow.name}`, {
      workflowId,
      replayedFromStep: targetStepId,
    });
    const span = tracer.startSpan(trace.id, `replay_init`, "workflow");

    log.info(`Initiating workflow replay for [${workflowId}] from step [${targetStepId}] (index: ${targetStepIndex})`);

    // Restore step results and context from snapshot immediately before target step
    let contextData: Record<string, unknown> = {};
    let stepResults: Record<string, unknown> = {};

    const priorSnapshot = snapshots.filter((s) => s.stepIndex < targetStepIndex).pop();
    if (priorSnapshot) {
      contextData = { ...priorSnapshot.contextData };
      stepResults = { ...priorSnapshot.stepResults };
    }

    // Apply any context overrides
    if (options?.contextOverrides) {
      contextData = { ...contextData, ...options.contextOverrides };
    }

    // Reset steps from targetStepIndex onwards to PENDING
    for (let i = targetStepIndex; i < workflow.steps.length; i++) {
      const step = workflow.steps[i];
      step.status = "PENDING" as StepStatus;
      step.error = undefined;
      step.output = undefined;
      step.startedAt = undefined;
      step.completedAt = undefined;
      delete stepResults[step.id];
    }

    workflow.status = "RUNNING";
    workflow.currentStepIndex = targetStepIndex;
    workflow.updatedAt = Date.now();

    // Persist updated workflow state to stateStore
    updateTask(workflowId, (current) => {
      return {
        ...current,
        status: "running",
        steps: workflow.steps,
        metadata: {
          ...(current.metadata || {}),
          name: workflow.name,
          currentStepIndex: targetStepIndex,
          replayedAt: Date.now(),
        },
      };
    });

    const executionContext = getOrCreateExecutionContext(workflow);
    executionContext.stepResults = stepResults;
    if (options?.contextOverrides) {
      executionContext.variables = { ...executionContext.variables, ...options.contextOverrides };
    }

    tracer.endSpan(span.id, { targetStepId, stepsReset: workflow.steps.length - targetStepIndex });

    // Execute through executeAllSteps within trace context
    let executedWorkflow: Workflow;
    try {
      executedWorkflow = await tracer.runWithContext({ traceId: trace.id }, () => executeAllSteps(workflowId));
      tracer.endTrace(trace.id, executedWorkflow.status === "COMPLETED" ? "completed" : "failed");
    } catch (err: any) {
      tracer.endTrace(trace.id, "failed", err?.message || String(err));
      throw err;
    }

    return {
      success: executedWorkflow.status === "COMPLETED",
      workflow: executedWorkflow,
      replayedFromStep: targetStepId,
    };
  }

  /** Clears all snapshots (for test cleanup) */
  clear(): void {
    this.snapshots.clear();
  }
}

export const workflowReplayManager = new WorkflowReplayManager();
