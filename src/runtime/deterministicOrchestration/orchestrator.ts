// src/runtime/deterministicOrchestration/orchestrator.ts
//
// REAL deterministic workflow execution engine.
// Executes an ExecutionPlan step-by-step, propagates context between steps,
// tracks shared state, and aggregates a truthful WorkflowResult.
//
// NO autonomous reasoning. NO self-planning. NO LLM calls.
// Pure deterministic dispatch through the existing dispatcher.

import {
  ExecutionPlan,
  ExecutionState,
  StepResult,
  WorkflowResult,
  WorkflowStatus,
  DeterministicExecutionLog,
} from "./types.ts";
import { resolveStep } from "./stepResolver.ts";
import { dispatchTool } from "@tools/dispatcher.ts";
import { normalizeToolResult } from "@tools/toolResult.ts";
import { createLogger } from "@utils/logger.ts";

const log = createLogger("runtime/deterministicOrchestration");

// ─── State factory ────────────────────────────────────────────────────────────

function createInitialExecutionState(totalSteps: number): ExecutionState {
  return {
    totalSteps,
    currentStep: 0,
    stepResults: [],
    completedSteps: [],
    failedStep: null,
    status: "pending",
    startTime: Date.now(),
    endTime: 0,
    browserState: {
      isLaunched: false,
      activeContext: false,
      currentUrl: null
    }
  };
}

// ─── Result aggregator ────────────────────────────────────────────────────────

function buildWorkflowSummary(state: ExecutionState): string {
  const lines: string[] = [];

  for (const r of state.stepResults) {
    if (r.success) {
      lines.push(`✅ ${r.command} — ${r.message}`);
    } else {
      const reason = r.error ?? r.message;
      lines.push(`❌ ${r.command} — ${reason}`);
    }
  }

  const statusLine =
    state.status === "completed"
      ? `\n✔ Workflow completed (${state.totalSteps}/${state.totalSteps} steps).`
      : state.status === "partial_success"
        ? `\n⚠ Workflow partially completed (${state.completedSteps.length}/${state.totalSteps} steps succeeded).`
        : `\n✖ Workflow failed at step: "${state.failedStep}".`;

  return lines.join("\n") + statusLine;
}

// ─── Main engine ─────────────────────────────────────────────────────────────

/**
 * Execute an ExecutionPlan deterministically.
 *
 * Each step is:
 *  1. Resolved to a {toolId, params} pair via stepResolver (no LLM)
 *  2. Dispatched through the existing dispatchTool
 *  3. Normalised into a StepResult
 *  4. Used to update shared ExecutionState
 *
 * The next step always receives the previous StepResult as context.
 * Execution is sequential and stops on the first hard failure.
 */
export async function executeWorkflow(plan: ExecutionPlan): Promise<WorkflowResult> {
  const state = createInitialExecutionState(plan.steps.length);
  state.status = "running";

  log.info(DeterministicExecutionLog.WORKFLOW_START, {
    totalSteps: state.totalSteps,
    commands: plan.steps.map((s) => s.command),
  });
  console.log(`[${DeterministicExecutionLog.WORKFLOW_START}]`, {
    totalSteps: state.totalSteps,
  });

  let previousResult: StepResult | null = null;

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    state.currentStep = i;

    log.info(DeterministicExecutionLog.STEP_START, {
      stepIndex: i,
      command: step.command,
      previousSuccess: previousResult?.success ?? null,
    });
    console.log(`[${DeterministicExecutionLog.STEP_START}]`, {
      stepIndex: i,
      command: step.command,
    });

    const stepStarted = Date.now();

    // ── 1. Resolve the command to a tool ──────────────────────────────────────
    // Resolve the command to a tool
    const resolved = resolveStep(step.command);

    let stepResult: StepResult;

    if (!resolved) {
      // Cannot map this command deterministically — record as failure
      stepResult = {
        stepIndex: i,
        command: step.command,
        toolId: "unknown",
        success: false,
        message: `Could not resolve command to a tool: "${step.command}"`,
        durationMs: Date.now() - stepStarted,
        error: "NO_TOOL_RESOLVED",
      };
    } else {
      // Augment params with previous result and shared state for context propagation
      const augmentedParams = {
        ...resolved.params,
        __prevResult: previousResult,
        __state: state,
      };
      // Dispatch the tool
      try {
        const rawResult = await dispatchTool(resolved.toolId, augmentedParams);
        const toolResult = normalizeToolResult(
          resolved.toolId,
          stepStarted,
          rawResult,
          `${step.command} completed`
        );

        stepResult = {
          stepIndex: i,
          command: step.command,
          toolId: resolved.toolId,
          success: toolResult.success,
          message: toolResult.message,
          durationMs: toolResult.durationMs,
          error: toolResult.error,
          data: toolResult.data,
        };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        stepResult = {
          stepIndex: i,
          command: step.command,
          toolId: resolved.toolId,
          success: false,
          message: `Tool "${resolved.toolId}" threw an error`,
          durationMs: Date.now() - stepStarted,
          error: errorMsg,
        };
      }
    }

    // ── 3. Update shared state ────────────────────────────────────────────────
    state.stepResults.push(stepResult);

    if (stepResult.success) {
      state.completedSteps.push(step.command);
    } else if (!state.failedStep) {
      state.failedStep = step.command;
    }

    log.info(DeterministicExecutionLog.STEP_RESULT, {
      stepIndex: i,
      command: step.command,
      success: stepResult.success,
      message: stepResult.message,
      durationMs: stepResult.durationMs,
    });
    console.log(`[${DeterministicExecutionLog.STEP_RESULT}]`, {
      stepIndex: i,
      success: stepResult.success,
      command: step.command,
    });

    log.info(DeterministicExecutionLog.STATE_UPDATED, {
      currentStep: i,
      completedCount: state.completedSteps.length,
      failedStep: state.failedStep,
    });

    previousResult = stepResult;

    // ── 4. Continue or stop ───────────────────────────────────────────────────
    // Only hard-stop on failures that are not browser/navigation steps,
    // so a failed "search youtube" won't kill the remaining screenshot step.
    // For now: continue all steps regardless (partial_success is valid).
  }

  // ── Determine final status ─────────────────────────────────────────────────
  state.endTime = Date.now();

  const succeeded = state.completedSteps.length;
  const total = state.totalSteps;

  if (succeeded === total) {
    state.status = "completed";
  } else if (succeeded > 0) {
    state.status = "partial_success";
  } else {
    state.status = "failed";
  }

  const totalDurationMs = state.endTime - state.startTime;
  const summary = buildWorkflowSummary(state);

  if (state.status === "completed" || state.status === "partial_success") {
    log.info(DeterministicExecutionLog.WORKFLOW_COMPLETE, {
      status: state.status,
      succeeded,
      total,
      totalDurationMs,
    });
    console.log(`[${DeterministicExecutionLog.WORKFLOW_COMPLETE}]`, {
      status: state.status,
      succeeded,
      total,
    });
  } else {
    log.error(DeterministicExecutionLog.WORKFLOW_FAILED, undefined, {
      failedStep: state.failedStep,
      totalDurationMs,
    });
    console.log(`[${DeterministicExecutionLog.WORKFLOW_FAILED}]`, {
      failedStep: state.failedStep,
    });
  }

  return {
    status: state.status,
    summary,
    stepResults: state.stepResults,
    totalDurationMs,
  };
}

/**
 * Legacy shim — kept for backward compatibility with any existing callers.
 * Delegates to executeWorkflow and returns the summary string.
 */
// Legacy shim — kept for backward compatibility. Now returns full WorkflowResult.
export async function executePlan(plan: ExecutionPlan): Promise<WorkflowResult> {
  // Use the main workflow engine to execute the plan and return the detailed result.
  const result = await executeWorkflow(plan);
  return result;
}
