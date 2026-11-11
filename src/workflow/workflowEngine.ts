// ════════════════════════════════════════════════════════════════════════════════
// src/workflow/workflowEngine.ts — Workflow Engine DAG Foundation (Phase 6.4 / 6.5)
// Deterministic, persistent, observable, and safe DAG execution state machine.
// ════════════════════════════════════════════════════════════════════════════════

import { createLogger } from "@utils/logger.js";
import { recordMetric, incrementCounter } from "../monitoring/metrics.js";
import { tracer } from "../monitoring/tracer.js";
import { workflowReplayManager } from "../monitoring/workflowReplay.js";
import { dispatchTool } from "../tools/dispatcher.js";
import { checkToolSafety, validateCommand } from "../tools/safety.js";
import { createTask, updateTask, getTask, listTasks as listStateTasks, deleteTask } from "../orchestrator/stateStore.js";
import { interpolateValue } from "./interpolator.js";
import { validateDag, getExecutableSteps } from "./dagEvaluator.js";
import {
  type Workflow,
  type WorkflowStep,
  type WorkflowStatus,
  type StepStatus,
  type CreateWorkflowParams,
  type WorkflowExecutionContext,
  type WorkflowErrorCode,
  type StepClaim,
  type RecoveryOptions,
  type WorkflowRecoveryResult,
  WorkflowError,
} from "./types.js";

const log = createLogger("workflow/engine");

/** In-memory registry of active execution contexts */
const executionContexts = new Map<string, WorkflowExecutionContext>();

/** In-memory registry of active step execution leases/claims for concurrency protection */
const stepClaims = new Map<string, StepClaim>();

/** Sensitive parameter key pattern for persistence sanitization */
const SENSITIVE_KEY_REGEX = /(password|secret|token|apikey|api_key|auth_header|authorization|private_key|credential)/i;

/** Recursively sanitizes sensitive parameters before persisting to stateStore */
function sanitizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_KEY_REGEX.test(k)) {
        sanitized[k] = "[REDACTED_SECRET]";
      } else {
        sanitized[k] = sanitizeValue(v);
      }
    }
    return sanitized;
  }
  return value;
}

/** Check if a tool is safe / read-only / idempotent for auto-recovery */
export function isToolIdempotent(toolId?: string): boolean {
  if (!toolId) return false;
  const idempotentTools = new Set([
    "fs.read_file",
    "fs.list_directory",
    "fs.search_files",
    "fs.file_metadata",
    "browser.navigate",
    "browser.screenshot",
    "browser.extract_text",
    "system.info",
    "system.process_list",
    "system.env",
    "git.status",
    "computer.screenshot",
    "computer.get_text",
  ]);
  return idempotentTools.has(toolId);
}

/** Returns all active step claims */
export function getActiveClaims(): StepClaim[] {
  return Array.from(stepClaims.values());
}

/** Clears all active step claims (used in tests or engine resets) */
export function clearActiveClaims(): void {
  stepClaims.clear();
}

/** Maps TaskState from stateStore to Workflow domain model */
function mapTaskStateToWorkflow(taskState: any): Workflow {
  if (!taskState || typeof taskState !== "object") {
    throw new WorkflowError("Corrupted workflow state: task is not an object", "VALIDATION_ERROR", "corrupted");
  }
  return {
    id: taskState.taskId || "unknown",
    name: taskState.metadata?.name || taskState.taskId || "unknown",
    description: taskState.metadata?.description,
    status: (taskState.status || "PENDING").toUpperCase() as WorkflowStatus,
    steps: Array.isArray(taskState.steps) ? taskState.steps : [],
    currentStepIndex: typeof taskState.metadata?.currentStepIndex === "number" ? taskState.metadata.currentStepIndex : 0,
    createdAt: taskState.createdAt ? new Date(taskState.createdAt).getTime() : Date.now(),
    updatedAt: taskState.updatedAt ? new Date(taskState.updatedAt).getTime() : Date.now(),
    startedAt: taskState.metadata?.startedAt,
    completedAt: taskState.metadata?.completedAt,
    metadata: taskState.metadata || {},
  };
}

/** Maps Workflow domain model back to TaskState for stateStore persistence (with secret sanitization) */
function mapWorkflowToTaskState(workflow: Workflow): any {
  const sanitizedSteps = workflow.steps.map((s) => ({
    ...s,
    input: sanitizeValue(s.input) as WorkflowStep["input"],
    output: sanitizeValue(s.output),
  }));

  return {
    taskId: workflow.id,
    status: workflow.status.toLowerCase(),
    steps: sanitizedSteps,
    outputs: sanitizedSteps.map((s) => s.output).filter((o) => o !== undefined),
    artifacts: [],
    errors: sanitizedSteps.map((s) => s.error).filter(Boolean),
    createdAt: new Date(workflow.createdAt).toISOString(),
    updatedAt: new Date(workflow.updatedAt).toISOString(),
    metadata: sanitizeValue({
      ...(workflow.metadata || {}),
      name: workflow.name,
      description: workflow.description,
      currentStepIndex: workflow.currentStepIndex,
      startedAt: workflow.startedAt,
      completedAt: workflow.completedAt,
    }),
  };
}

/**
 * Gets or creates the execution context for a workflow, restoring persisted outputs if needed.
 */
export function getOrCreateExecutionContext(workflow: Workflow): WorkflowExecutionContext {
  let context = executionContexts.get(workflow.id);
  if (!context) {
    context = {
      workflowId: workflow.id,
      correlationId: (workflow.metadata?.correlationId as string) || workflow.id,
      stepResults: {},
      variables: (workflow.metadata?.variables as Record<string, unknown>) || {},
    };
    executionContexts.set(workflow.id, context);
  }
  for (const step of workflow.steps) {
    if (step.output !== undefined && context.stepResults[step.id] === undefined) {
      context.stepResults[step.id] = step.output;
    }
  }
  return context;
}

/**
 * Recursively skips unreachable nodes after a branch decision without skipping shared merge nodes.
 */
function skipUnreachableBranchNodes(workflow: Workflow, startSkipId?: string): void {
  if (!startSkipId) return;
  const stepMap = new Map<string, WorkflowStep>(workflow.steps.map((s) => [s.id, s]));
  const startStep = stepMap.get(startSkipId);
  if (!startStep || startStep.status !== "PENDING") return;

  const queue: string[] = [startSkipId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const step = stepMap.get(currentId);
    if (!step || step.status !== "PENDING") continue;

    // A step is unreachable ONLY IF all of its required parent dependencies are SKIPPED (or if it's the direct skipped branch target)
    let allParentsSkipped = true;
    if (step.id !== startSkipId && step.dependsOn && step.dependsOn.length > 0) {
      for (const parentId of step.dependsOn) {
        const parent = stepMap.get(parentId);
        if (!parent || parent.status !== "SKIPPED") {
          allParentsSkipped = false;
          break;
        }
      }
    }

    if (allParentsSkipped) {
      step.status = "SKIPPED";
      step.completedAt = Date.now();
      incrementCounter("workflow.step.skipped");
      log.info(`Workflow [${workflow.id}] step [${step.id}] marked SKIPPED (unreachable branch path).`);

      for (const childStep of workflow.steps) {
        if (childStep.status === "PENDING" && childStep.dependsOn?.includes(currentId)) {
          queue.push(childStep.id);
        }
      }
    }
  }
}

// ─── Core Workflow Lifecycle Operations ────────────────────────────────────────

/**
 * Creates a new Workflow instance, validates DAG structure, and persists state.
 */
export function createWorkflow(params: CreateWorkflowParams): Workflow {
  if (!params || !params.name || typeof params.name !== "string" || params.name.trim() === "") {
    throw new WorkflowError("Workflow creation failed: missing or invalid name.", "VALIDATION_ERROR", "unknown");
  }

  if (!params.steps || !Array.isArray(params.steps) || params.steps.length === 0) {
    throw new WorkflowError("Workflow creation failed: steps array must contain at least one step.", "VALIDATION_ERROR", "unknown");
  }

  const workflowId = params.id || `wf_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const now = Date.now();

  const formattedSteps: WorkflowStep[] = [];
  const hasExplicitDependsOn = params.steps.some((s) => s.dependsOn && Array.isArray(s.dependsOn));

  for (let idx = 0; idx < params.steps.length; idx++) {
    const s = params.steps[idx];
    if (!s.name || !s.type || !s.input) {
      throw new WorkflowError(`Invalid step definition at index ${idx}`, "VALIDATION_ERROR", workflowId);
    }

    const stepId = s.id || `step_${idx + 1}_${Date.now()}_${idx}`;

    let stepDependsOn: string[] = [];
    if (s.dependsOn && Array.isArray(s.dependsOn)) {
      stepDependsOn = s.dependsOn;
    } else if (!hasExplicitDependsOn && idx > 0) {
      stepDependsOn = [formattedSteps[idx - 1].id];
    }

    formattedSteps.push({
      id: stepId,
      name: s.name,
      type: s.type,
      status: "PENDING",
      input: s.input,
      dependsOn: stepDependsOn,
      retryCount: 0,
      metadata: s.metadata,
    });
  }

  const workflow: Workflow = {
    id: workflowId,
    name: params.name,
    description: params.description,
    status: "PENDING",
    steps: formattedSteps,
    currentStepIndex: 0,
    createdAt: now,
    updatedAt: now,
    metadata: params.metadata || {},
  };

  // Validate DAG structure & cycles
  validateDag(workflow);
  incrementCounter("workflow.dag.validated");

  // Persist task state using stateStore infrastructure
  createTask(workflowId, mapWorkflowToTaskState(workflow));

  // Initialize execution context
  executionContexts.set(workflowId, {
    workflowId,
    correlationId: (params.metadata?.correlationId as string) || workflowId,
    stepResults: {},
    variables: (params.metadata?.variables as Record<string, unknown>) || {},
  });

  log.info(`Workflow created: [${workflow.id}] "${workflow.name}" with ${workflow.steps.length} steps (DAG validated).`);
  incrementCounter("workflow.created");
  return workflow;
}

/**
 * Retrieves a workflow by ID from the persistent state store.
 */
export function getWorkflow(workflowId: string): Workflow | undefined {
  const task = getTask(workflowId);
  return task ? mapTaskStateToWorkflow(task) : undefined;
}

/**
 * Returns current status of a workflow.
 */
export function getWorkflowStatus(workflowId: string): WorkflowStatus | undefined {
  return getWorkflow(workflowId)?.status;
}

/**
 * Lists all registered workflows.
 */
export function listWorkflows(): Workflow[] {
  const result: Workflow[] = [];
  for (const taskState of listStateTasks()) {
    try {
      result.push(mapTaskStateToWorkflow(taskState));
    } catch (err: any) {
      log.warn(`Skipped malformed task state [${taskState?.taskId}]: ${err.message}`);
    }
  }
  return result;
}

/**
 * Deletes a workflow and its execution state.
 */
export function deleteWorkflow(workflowId: string): void {
  deleteTask(workflowId);
  executionContexts.delete(workflowId);
  log.info(`Deleted workflow [${workflowId}]`);
}

// ─── Crash Recovery & Self-Healing Engine ──────────────────────────────────────

/**
 * Scans persisted workflows, identifies interrupted RUNNING steps,
 * and recovers safe idempotent steps while safely marking side-effecting steps as UNKNOWN/FAILED.
 */
export function recoverWorkflows(options?: RecoveryOptions): WorkflowRecoveryResult {
  log.info("Starting workflow recovery inspection...");
  incrementCounter("workflow.recovery.started");
  incrementCounter("workflow.recovery.dag");

  const allWorkflows = listWorkflows();
  let recoveredCount = 0;
  let failedCount = 0;
  let unknownCount = 0;
  const updatedWorkflows: Workflow[] = [];

  for (const wf of allWorkflows) {
    const isInterruptedWf = wf.status === "RUNNING";
    const hasInterruptedStep = wf.steps.some((s) => s.status === "RUNNING" || s.status === "UNKNOWN");

    if (!isInterruptedWf && !hasInterruptedStep) {
      if (wf.status === "WAITING") {
        incrementCounter("workflow.waiting.recovery");
        log.info(`Workflow recovery verified waiting state for workflow [${wf.id}].`);
      }
      continue;
    }

    let workflowMutated = false;

    for (let i = 0; i < wf.steps.length; i++) {
      const step = wf.steps[i];
      if (step.status === "RUNNING") {
        workflowMutated = true;
        const isReadonly = step.type === "TOOL" && isToolIdempotent(step.input.toolId);

        if (isReadonly && options?.autoRetryReadonly !== false) {
          step.status = "PENDING";
          step.metadata = {
            ...(step.metadata || {}),
            recoveredAt: Date.now(),
            recoveryAction: "RESET_TO_PENDING",
          };
          recoveredCount++;
          log.info(`Workflow [${wf.id}] step [${step.id}] recovered (safe read-only tool '${step.input.toolId}' reset to PENDING).`);
          incrementCounter("workflow.step.recovered");
        } else {
          step.status = "UNKNOWN";
          step.error = `Interrupted mid-execution: non-idempotent or dangerous step requires manual recovery (toolId: '${step.input.toolId || "none"}')`;
          step.metadata = {
            ...(step.metadata || {}),
            recoveredAt: Date.now(),
            recoveryAction: "MARKED_UNKNOWN_RECOVERY_REQUIRED",
          };
          wf.status = "FAILED";
          wf.completedAt = Date.now();
          failedCount++;
          unknownCount++;
          log.warn(`Workflow [${wf.id}] step [${step.id}] marked UNKNOWN/FAILED (side-effect or dangerous step).`);
          incrementCounter("workflow.step.recovery_required");
        }
      }
    }

    if (workflowMutated) {
      wf.updatedAt = Date.now();
      updateTask(wf.id, () => mapWorkflowToTaskState(wf));
      updatedWorkflows.push(wf);
    }
  }

  log.info(`Workflow recovery complete: ${recoveredCount} step(s) reset to PENDING, ${failedCount} workflow(s) marked FAILED/UNKNOWN.`);
  incrementCounter("workflow.recovery.completed");

  return {
    recoveredCount,
    failedCount,
    unknownCount,
    workflows: updatedWorkflows,
  };
}

// ─── State Machine & Execution Engine ──────────────────────────────────────────

/**
 * Starts a workflow in PENDING state.
 */
export async function startWorkflow(workflowId: string): Promise<Workflow> {
  const workflow = getWorkflow(workflowId);
  if (!workflow) {
    throw new WorkflowError(`Workflow [${workflowId}] not found`, "VALIDATION_ERROR", workflowId);
  }

  if (workflow.status !== "PENDING") {
    throw new WorkflowError(
      `Cannot start workflow [${workflowId}] in state '${workflow.status}'. Workflow must be in 'PENDING' state.`,
      "VALIDATION_ERROR",
      workflowId
    );
  }

  const now = Date.now();
  workflow.status = "RUNNING";
  workflow.startedAt = now;
  workflow.updatedAt = now;

  updateTask(workflowId, () => mapWorkflowToTaskState(workflow));

  log.info(`Workflow started: [${workflow.id}] "${workflow.name}"`);
  incrementCounter("workflow.started");
  return workflow;
}

/**
 * Executes a ready step in a RUNNING workflow deterministically.
 */
export async function executeNextStep(
  workflowId: string,
  targetStepId?: string
): Promise<{ workflow: Workflow; stepResult?: WorkflowStep }> {
  const workflow = getWorkflow(workflowId);
  if (!workflow) {
    throw new WorkflowError(`Workflow [${workflowId}] not found`, "VALIDATION_ERROR", workflowId);
  }

  if (workflow.status !== "RUNNING") {
    throw new WorkflowError(
      `Cannot execute step for workflow [${workflowId}] in status '${workflow.status}'. Workflow must be RUNNING.`,
      "VALIDATION_ERROR",
      workflowId
    );
  }

  // Select step to execute
  let step: WorkflowStep | undefined;
  if (targetStepId) {
    step = workflow.steps.find((s) => s.id === targetStepId);
  } else {
    const executableSteps = getExecutableSteps(workflow);
    step = executableSteps[0];
  }

  // Check completion if no steps left
  if (!step) {
    const allTerminal = workflow.steps.every((s) => s.status === "COMPLETED" || s.status === "SKIPPED");
    if (allTerminal) {
      const now = Date.now();
      workflow.status = "COMPLETED";
      workflow.completedAt = now;
      workflow.updatedAt = now;
      updateTask(workflowId, () => mapWorkflowToTaskState(workflow));

      log.info(`Workflow completed: [${workflow.id}] "${workflow.name}"`);
      incrementCounter("workflow.completed");
      return { workflow };
    }

    // Check if any step is currently executing
    const hasRunning = workflow.steps.some((s) => s.status === "RUNNING");
    if (hasRunning) {
      throw new WorkflowError(
        `A step in workflow [${workflowId}] is currently executing.`,
        "CONCURRENCY_ERROR",
        workflowId
      );
    }

    // Check if workflow has any pending or waiting steps
    const hasWaiting = workflow.steps.some((s) => s.status === "WAITING");
    if (hasWaiting) {
      workflow.status = "WAITING";
      workflow.updatedAt = Date.now();
      updateTask(workflowId, () => mapWorkflowToTaskState(workflow));
      return { workflow };
    }

    return { workflow };
  }

  // Idempotency Protection: If step is COMPLETED or SKIPPED
  if (step.status === "COMPLETED" || step.status === "SKIPPED") {
    log.info(`Step [${step.id}] already ${step.status}.`);
    return { workflow, stepResult: step };
  }

  // Concurrency Claim Protection
  const claimKey = `${workflowId}:${step.id}`;
  if (stepClaims.has(claimKey)) {
    throw new WorkflowError(
      `Step [${step.id}] of workflow [${workflowId}] is currently being executed by another process/caller.`,
      "CONCURRENCY_ERROR",
      workflowId,
      step.id
    );
  }

  const executionId = `exec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const claim: StepClaim = {
    workflowId,
    stepId: step.id,
    executionId,
    claimedAt: Date.now(),
  };
  stepClaims.set(claimKey, claim);
  incrementCounter("workflow.step.claimed");

  try {
    const stepStart = Date.now();
    step.status = "RUNNING";
    step.startedAt = stepStart;
    workflow.updatedAt = stepStart;
    updateTask(workflowId, () => mapWorkflowToTaskState(workflow));

    log.info(`Workflow [${workflowId}] step started: [${step.id}] "${step.name}" (${step.type})`);
    incrementCounter("workflow.step.started");
    incrementCounter("workflow.step.ready");

    const activeTraceCtx = tracer.getActiveContext();
    const stepSpan = activeTraceCtx
      ? tracer.startSpan(activeTraceCtx.traceId, `step:${step.name}`, "workflow", activeTraceCtx.parentSpanId, {
          stepId: step.id,
          type: step.type,
        })
      : undefined;

    const context = getOrCreateExecutionContext(workflow);

    // Interpolate input values immediately before execution
    const interpolatedInput = interpolateValue(step.input, context);

    try {
      let result: unknown;

      if (step.type === "TOOL") {
        const toolId = interpolatedInput.toolId;
        if (!toolId) {
          throw new WorkflowError(`TOOL step [${step.id}] missing 'toolId' in input.`, "VALIDATION_ERROR", workflowId, step.id);
        }

        const safetyCheck = checkToolSafety(toolId);
        if (!safetyCheck.allowed) {
          throw new WorkflowError(`Safety policy blocked tool '${toolId}': ${safetyCheck.reason}`, "SAFETY_ERROR", workflowId, step.id);
        }

        if (interpolatedInput.params?.command && typeof interpolatedInput.params.command === "string") {
          const cmdCheck = validateCommand(interpolatedInput.params.command);
          if (!cmdCheck.allowed) {
            throw new WorkflowError(`Safety policy blocked shell command: ${cmdCheck.reason}`, "SAFETY_ERROR", workflowId, step.id);
          }
        }

        result = await dispatchTool(toolId, interpolatedInput.params || {});
      } else if (step.type === "ACTION") {
        if (interpolatedInput.actionFn) {
          result = await interpolatedInput.actionFn(context);
        } else {
          result = { success: true, action: interpolatedInput.actionName || step.name };
        }
      } else if (step.type === "CONDITION") {
        if (interpolatedInput.conditionFn) {
          result = await interpolatedInput.conditionFn(context);
        } else {
          result = true;
        }
      } else if (step.type === "WAIT") {
        const durationMs = interpolatedInput.durationMs;
        let resumeAt = interpolatedInput.resumeAt;

        if (resumeAt === undefined && (typeof durationMs !== "number" || isNaN(durationMs) || durationMs <= 0)) {
          throw new WorkflowError(
            `WAIT step [${step.id}] requires a positive 'durationMs' or valid 'resumeAt' timestamp.`,
            "VALIDATION_ERROR",
            workflowId,
            step.id
          );
        }

        const now = Date.now();
        if (resumeAt === undefined) {
          resumeAt = now + (durationMs as number);
          step.input.resumeAt = resumeAt;
        }

        if (now < resumeAt) {
          step.status = "WAITING";
          step.startedAt = stepStart;
          workflow.status = "WAITING";
          workflow.updatedAt = now;
          updateTask(workflowId, () => mapWorkflowToTaskState(workflow));

          incrementCounter("workflow.step.waiting");
          log.info(`Workflow [${workflowId}] step [${step.id}] entering WAITING state until ${new Date(resumeAt).toISOString()}`);

          return { workflow, stepResult: step };
        } else {
          result = { resumedAt: now, waitDurationMs: durationMs || 0, resumeAt, delayed: true };
        }
      } else if (step.type === "BRANCH") {
        let conditionResult = false;
        if (interpolatedInput.conditionFn) {
          conditionResult = Boolean(await interpolatedInput.conditionFn(context));
        } else if (interpolatedInput.params?.condition !== undefined) {
          conditionResult = Boolean(interpolatedInput.params.condition);
        } else {
          conditionResult = true;
        }

        const chosenTarget = conditionResult ? interpolatedInput.thenStepId : interpolatedInput.elseStepId;
        const skippedTarget = conditionResult ? interpolatedInput.elseStepId : interpolatedInput.thenStepId;

        skipUnreachableBranchNodes(workflow, skippedTarget);
        incrementCounter("workflow.branch.selected");

        result = {
          branchResult: conditionResult,
          chosenStepId: chosenTarget,
          skippedStepId: skippedTarget,
        };
      } else if (step.type === "PARALLEL") {
        incrementCounter("workflow.parallel.started");
        const maxConcurrency = interpolatedInput.maxConcurrency || 4;
        let parallelSubResults: Record<string, unknown> = {};

        if (interpolatedInput.parallelSteps && Array.isArray(interpolatedInput.parallelSteps)) {
          const subSteps = interpolatedInput.parallelSteps;
          for (let i = 0; i < subSteps.length; i += maxConcurrency) {
            const batch = subSteps.slice(i, i + maxConcurrency);
            const batchResults = await Promise.all(
              batch.map(async (sub) => {
                if (sub.type === "ACTION" && sub.input.actionFn) {
                  return { id: sub.id, output: await sub.input.actionFn(context) };
                }
                if (sub.type === "TOOL" && sub.input.toolId) {
                  return { id: sub.id, output: await dispatchTool(sub.input.toolId, sub.input.params || {}) };
                }
                return { id: sub.id, output: { success: true } };
              })
            );

            for (const r of batchResults) {
              parallelSubResults[r.id] = r.output;
              context.stepResults[r.id] = r.output;
            }
          }
        }

        incrementCounter("workflow.parallel.completed");
        result = parallelSubResults;
      } else {
        throw new WorkflowError(`Unsupported step type: '${step.type}'`, "VALIDATION_ERROR", workflowId, step.id);
      }

      // Step Success Path
      const stepEnd = Date.now();
      step.status = "COMPLETED";
      step.output = result;
      step.completedAt = stepEnd;
      context.stepResults[step.id] = result;

      if (stepSpan) {
        tracer.endSpan(stepSpan.id, result);
      }
      workflowReplayManager.captureSnapshot(
        workflowId,
        step.id,
        workflow.currentStepIndex,
        "COMPLETED",
        context.variables,
        context.stepResults,
        { stepName: step.name, durationMs: stepEnd - stepStart }
      );

      // Update step index for linear compatibility
      const currentIdx = workflow.steps.findIndex((s) => s.id === step!.id);
      if (currentIdx >= 0 && currentIdx >= workflow.currentStepIndex) {
        workflow.currentStepIndex = currentIdx + 1;
      }
      workflow.updatedAt = stepEnd;

      updateTask(workflowId, (currentTaskState) => {
        const currentWf = mapTaskStateToWorkflow(currentTaskState);
        for (const localStep of workflow.steps) {
          const s = currentWf.steps.find((st) => st.id === localStep.id);
          if (s) {
            if (localStep.id === step!.id) {
              s.status = "COMPLETED";
              s.output = result;
              s.completedAt = stepEnd;
            } else if (localStep.status === "SKIPPED" && s.status === "PENDING") {
              s.status = "SKIPPED";
              s.completedAt = localStep.completedAt;
            }
          }
        }
        const currentIdx = currentWf.steps.findIndex((st) => st.id === step!.id);
        if (currentIdx >= 0 && currentIdx >= currentWf.currentStepIndex) {
          currentWf.currentStepIndex = currentIdx + 1;
        }
        const allTerminal = currentWf.steps.every((st) => st.status === "COMPLETED" || st.status === "SKIPPED");
        if (allTerminal) {
          currentWf.status = "COMPLETED";
          currentWf.completedAt = stepEnd;
          log.info(`Workflow completed successfully: [${currentWf.id}] "${currentWf.name}"`);
          incrementCounter("workflow.completed");
        }
        currentWf.updatedAt = stepEnd;
        return mapWorkflowToTaskState(currentWf);
      });
      recordMetric({ name: "workflow.step.duration_ms", value: stepEnd - stepStart });
      incrementCounter("workflow.step.completed");

      const refreshed = getWorkflow(workflowId) || workflow;
      return { workflow: refreshed, stepResult: step };
    } catch (err: any) {
      // Step Failure Path
      const stepEnd = Date.now();
      step.status = "FAILED";
      step.error = err.message || String(err);
      step.completedAt = stepEnd;

      if (stepSpan) {
        tracer.endSpan(stepSpan.id, undefined, err);
      }
      workflowReplayManager.captureSnapshot(
        workflowId,
        step.id,
        workflow.currentStepIndex,
        "FAILED",
        context.variables,
        context.stepResults,
        { stepName: step.name, error: step.error, durationMs: stepEnd - stepStart }
      );

      workflow.status = "FAILED";
      workflow.completedAt = stepEnd;
      workflow.updatedAt = stepEnd;

      updateTask(workflowId, (currentTaskState) => {
        const currentWf = mapTaskStateToWorkflow(currentTaskState);
        const s = currentWf.steps.find((st) => st.id === step!.id);
        if (s) {
          s.status = "FAILED";
          s.error = step!.error;
          s.completedAt = stepEnd;
        }
        currentWf.status = "FAILED";
        currentWf.completedAt = stepEnd;
        currentWf.updatedAt = stepEnd;
        return mapWorkflowToTaskState(currentWf);
      });

      log.error(`Workflow [${workflowId}] step failed: [${step.id}] (${step.error})`);
      incrementCounter("workflow.step.failed");
      incrementCounter("workflow.failed");

      if (err instanceof WorkflowError) {
        throw err;
      }

      const code: WorkflowErrorCode = err.name === "SafetyError" ? "SAFETY_ERROR" : "EXECUTION_ERROR";
      throw new WorkflowError(`Step execution failed: ${err.message}`, code, workflowId, step.id, err);
    }
  } finally {
    stepClaims.delete(claimKey);
    incrementCounter("workflow.step.released");
  }
}

/**
 * Internal execution loop for remaining steps in a DAG workflow.
 */
async function runExecuteAllSteps(workflowId: string): Promise<Workflow> {
  let wf = getWorkflow(workflowId);
  if (!wf) {
    throw new WorkflowError(`Workflow [${workflowId}] not found`, "VALIDATION_ERROR", workflowId);
  }

  if (wf.status === "PENDING") {
    wf = await startWorkflow(workflowId);
  }

  const maxConcurrency = (wf.metadata?.maxConcurrency as number) || 4;

  while (wf.status === "RUNNING") {
    const executableSteps = getExecutableSteps(wf);

    if (executableSteps.length === 0) {
      const allTerminal = wf.steps.every((s) => s.status === "COMPLETED" || s.status === "SKIPPED");
      if (allTerminal) {
        wf.status = "COMPLETED";
        wf.completedAt = Date.now();
        wf.updatedAt = Date.now();
        updateTask(workflowId, () => mapWorkflowToTaskState(wf!));
        break;
      }

      const hasWaiting = wf.steps.some((s) => s.status === "WAITING");
      if (hasWaiting) {
        wf.status = "WAITING";
        wf.updatedAt = Date.now();
        updateTask(workflowId, () => mapWorkflowToTaskState(wf!));
        break;
      }

      break;
    }

    // Execute batch up to maxConcurrency
    const batch = executableSteps.slice(0, maxConcurrency);
    if (batch.length === 1) {
      const res = await executeNextStep(workflowId, batch[0].id);
      wf = res.workflow;
    } else {
      await Promise.all(
        batch.map(async (step) => {
          try {
            await executeNextStep(workflowId, step.id);
          } catch (err: any) {
            log.warn(`Parallel step [${step.id}] failed: ${err.message}`);
          }
        })
      );
      const updated = getWorkflow(workflowId);
      if (updated) {
        wf = updated;
      }
    }
  }

  return wf;
}

/**
 * Executes all remaining steps in a DAG workflow sequentially or concurrently with controlled concurrency.
 */
export async function executeAllSteps(workflowId: string): Promise<Workflow> {
  const activeTrace = tracer.getActiveContext();
  if (activeTrace) {
    return runExecuteAllSteps(workflowId);
  }

  const initialWf = getWorkflow(workflowId);
  const trace = tracer.startTrace(`workflow:${initialWf?.name || workflowId}`, { workflowId });
  return tracer.runWithContext({ traceId: trace.id }, async () => {
    try {
      const result = await runExecuteAllSteps(workflowId);
      tracer.endTrace(trace.id, result.status === "COMPLETED" ? "completed" : "failed");
      return result;
    } catch (err: any) {
      tracer.endTrace(trace.id, "failed", err?.message || String(err));
      throw err;
    }
  });
}

/**
 * Scans persisted WAITING workflows and resumes those whose resumeAt timestamp has passed.
 */
export async function resumeWaitingWorkflows(nowMs: number = Date.now()): Promise<Workflow[]> {
  const allWorkflows = listWorkflows();
  const resumedWorkflows: Workflow[] = [];

  for (const wf of allWorkflows) {
    if (wf.status !== "WAITING") continue;

    const step = wf.steps.find((s) => s.status === "WAITING" && s.type === "WAIT");
    if (!step) continue;

    const resumeAt = step.input.resumeAt;
    if (resumeAt === undefined || resumeAt > nowMs) continue;

    const claimKey = `${wf.id}:${step.id}`;
    if (stepClaims.has(claimKey)) continue;

    const executionId = `exec_wait_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    stepClaims.set(claimKey, {
      workflowId: wf.id,
      stepId: step.id,
      executionId,
      claimedAt: Date.now(),
    });

    try {
      log.info(`Resuming WAITING workflow [${wf.id}] step [${step.id}] (resumeAt: ${new Date(resumeAt).toISOString()})...`);
      incrementCounter("workflow.step.resumed");

      const stepEnd = Date.now();
      step.status = "COMPLETED";
      step.output = { resumedAt: stepEnd, waitDurationMs: step.input.durationMs, resumeAt };
      step.completedAt = stepEnd;

      const context = getOrCreateExecutionContext(wf);
      context.stepResults[step.id] = step.output;

      wf.updatedAt = stepEnd;

      const allTerminal = wf.steps.every((s) => s.status === "COMPLETED" || s.status === "SKIPPED");
      if (allTerminal) {
        wf.status = "COMPLETED";
        wf.completedAt = stepEnd;
        log.info(`Workflow completed successfully after WAIT: [${wf.id}] "${wf.name}"`);
        incrementCounter("workflow.completed");
      } else {
        wf.status = "RUNNING";
      }

      updateTask(wf.id, () => mapWorkflowToTaskState(wf));
      resumedWorkflows.push(wf);

      if (wf.status === "RUNNING") {
        await executeAllSteps(wf.id);
      }
    } finally {
      stepClaims.delete(claimKey);
    }
  }

  return resumedWorkflows;
}

/**
 * Pauses a RUNNING or WAITING workflow. Prevents advancing to subsequent steps.
 */
export function pauseWorkflow(workflowId: string): Workflow {
  const workflow = getWorkflow(workflowId);
  if (!workflow) {
    throw new WorkflowError(`Workflow [${workflowId}] not found`, "VALIDATION_ERROR", workflowId);
  }

  if (workflow.status !== "RUNNING" && workflow.status !== "WAITING") {
    throw new WorkflowError(
      `Cannot pause workflow [${workflowId}] in state '${workflow.status}'. Workflow must be RUNNING or WAITING.`,
      "VALIDATION_ERROR",
      workflowId
    );
  }

  const now = Date.now();
  workflow.status = "PAUSED";
  workflow.updatedAt = now;

  updateTask(workflowId, () => mapWorkflowToTaskState(workflow));

  log.info(`Workflow paused: [${workflow.id}] "${workflow.name}"`);
  incrementCounter("workflow.paused");
  return workflow;
}

/**
 * Resumes a PAUSED workflow back to RUNNING status.
 */
export async function resumeWorkflow(workflowId: string): Promise<Workflow> {
  const workflow = getWorkflow(workflowId);
  if (!workflow) {
    throw new WorkflowError(`Workflow [${workflowId}] not found`, "VALIDATION_ERROR", workflowId);
  }

  if (workflow.status !== "PAUSED") {
    throw new WorkflowError(
      `Cannot resume workflow [${workflowId}] in state '${workflow.status}'. Workflow must be PAUSED.`,
      "VALIDATION_ERROR",
      workflowId
    );
  }

  const now = Date.now();
  workflow.status = "RUNNING";
  workflow.updatedAt = now;

  updateTask(workflowId, () => mapWorkflowToTaskState(workflow));

  log.info(`Workflow resumed: [${workflow.id}] "${workflow.name}"`);
  incrementCounter("workflow.resumed");
  return workflow;
}

/**
 * Cancels a PENDING, RUNNING, WAITING, or PAUSED workflow.
 */
export function cancelWorkflow(workflowId: string): Workflow {
  const workflow = getWorkflow(workflowId);
  if (!workflow) {
    throw new WorkflowError(`Workflow [${workflowId}] not found`, "VALIDATION_ERROR", workflowId);
  }

  if (workflow.status === "COMPLETED" || workflow.status === "FAILED" || workflow.status === "CANCELLED") {
    throw new WorkflowError(
      `Cannot cancel workflow [${workflowId}] in terminal state '${workflow.status}'.`,
      "VALIDATION_ERROR",
      workflowId
    );
  }

  const now = Date.now();
  workflow.status = "CANCELLED";
  workflow.completedAt = now;
  workflow.updatedAt = now;

  workflow.steps.forEach((step) => {
    if (step.status === "PENDING" || step.status === "RUNNING" || step.status === "WAITING") {
      step.status = "CANCELLED";
      step.completedAt = now;
    }
  });

  updateTask(workflowId, () => mapWorkflowToTaskState(workflow));

  log.info(`Workflow cancelled: [${workflow.id}] "${workflow.name}"`);
  incrementCounter("workflow.cancelled");
  return workflow;
}
