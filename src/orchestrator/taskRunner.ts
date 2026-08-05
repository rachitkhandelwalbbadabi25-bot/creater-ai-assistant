// src/orchestrator/taskRunner.ts

import { WorkflowStep, StepResult, WorkflowResult, WorkflowDefinition } from './types.js';
import { logExecution } from '../observability/executionLog.js';
import { retry as baseRetry, type RetryOptions } from '../utils/retry.js';
import { validateStep } from './validator.js';
import { updateTask, saveCheckpoint } from './stateStore.js';
import { StepTimeoutError, CancellationError, OrchestratorError } from './errors.js';
import { incrementCounter, startTimer } from '../observability/metrics.js';

// In‑memory cancellation registry
export const cancelledWorkflows = new Set<string>();

/** Execute a single step with timeout, retry, validation and cancellation support */
export async function runStep(
  workflowId: string,
  step: WorkflowStep,
  retryOpts?: RetryOptions
): Promise<StepResult> {
  // Check cancellation before starting
  if (cancelledWorkflows.has(workflowId)) {
    throw new CancellationError(workflowId);
  }

  const start = Date.now();
  logExecution({ action: 'step_start', status: 'running', module: 'orchestrator', stepId: step.id });
  incrementCounter('orchestrator.step.start');
  const stepTimer = startTimer('orchestrator.step.duration', { stepId: step.id });

  // Basic args validation
  try {
    validateStep(step.id, step.args);
  } catch (e) {
    logExecution({ action: 'step_validation_failed', status: 'failed', module: 'orchestrator', stepId: step.id, error: (e as Error).message });
    throw new OrchestratorError((e as Error).message, 'INVALID_STEP_ARGS');
  }

  // Resolve MCP client dynamically
  const clientModulePath = `../mcp/${step.agent}/${step.agent}Client.js`;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const clientModule = await import(clientModulePath);
  const actionFn = clientModule[step.action];
  if (typeof actionFn !== 'function') {
    throw new OrchestratorError(`Action ${step.action} not found on agent ${step.agent}`, 'INVALID_ACTION');
  }

  // Prepare execution wrapper
  const exec = async () => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore – dynamic args
    return await actionFn(step.args);
  };

  // Apply retry if needed
  const execWithRetry = async () => {
    if (retryOpts) {
      return await baseRetry(exec, retryOpts);
    }
    return await exec();
  };

  // Timeout handling via Promise.race
  const timeoutMs = step.timeoutMs ?? 0;
  const execPromise = execWithRetry();
  let result: any;
  try {
    if (timeoutMs > 0) {
      result = await Promise.race([
        execPromise,
        new Promise((_, reject) => setTimeout(() => reject(new StepTimeoutError(step.id)), timeoutMs)),
      ]);
    } else {
      result = await execPromise;
    }
  } catch (err) {
    // Record failure in state store
    updateTask(workflowId, (t) => ({
      ...t,
      status: 'failed',
      steps: [...t.steps, step.id],
      errors: [...t.errors, err],
    }));
    logExecution({ action: 'step_failed', status: 'failed', module: 'orchestrator', stepId: step.id, error: (err as Error).message });
    stepTimer.end();
    incrementCounter('orchestrator.step.failure');
    throw err;
  }

  const duration = Date.now() - start;
  // Update state store with success
  updateTask(workflowId, (t) => ({
    ...t,
    status: 'running',
    steps: [...t.steps, step.id],
    outputs: [...t.outputs, result],
  }));

  // Persist checkpoint after successful step
  await saveCheckpoint(workflowId);

  stepTimer.end();
  logExecution({ action: 'step_end', status: 'success', module: 'orchestrator', stepId: step.id });
  incrementCounter('orchestrator.step.end');

  return {
    stepId: step.id,
    success: true,
    output: result,
    durationMs: duration,
  };
}

/** Execute an entire workflow definition */
export async function runWorkflow(definition: WorkflowDefinition): Promise<WorkflowResult> {
  const { taskId } = definition;
  // Initialise task in state store
  updateTask(taskId, (t) => ({
    ...t,
    status: 'running',
    name: definition.name,
  }));

  const start = Date.now();
  logExecution({ action: 'workflow_start', status: 'running', module: 'orchestrator', taskId });
  incrementCounter('orchestrator.workflow.start');
  const workflowTimer = startTimer('orchestrator.workflow.duration', { taskId });

  // Build and sort graph
  const { buildGraph, validateGraph, topologicalSort } = await import('./executionGraph.js');
  const graph = buildGraph(definition);
  validateGraph(graph);
  const order = topologicalSort(graph);

  const stepResults: StepResult[] = [];
  for (const stepId of order) {
    const step = definition.steps.find((s) => s.id === stepId)!;
    try {
      const stepResult = await runStep(taskId, step, { attempts: 3, delayMs: 10 });
      stepResults.push(stepResult);
    } catch (err) {
      // If step has compensation, run it (simplified – just log)
      if (step.compensate) {
        // Execute compensation step without further compensation to avoid loops
        try {
          await runStep(taskId, step.compensate);
        } catch (_) {}
      }
      // Mark workflow as failed and rethrow
      updateTask(taskId, (t) => ({ ...t, status: 'failed' }));
      workflowTimer.end();
      logExecution({ action: 'workflow_end', status: 'failed', module: 'orchestrator', taskId });
      incrementCounter('orchestrator.workflow.failure');
      const duration = Date.now() - start;
      return {
        taskId,
        success: false,
        stepResults,
        artifacts: [],
        durationMs: duration,
      };
    }
    if (cancelledWorkflows.has(taskId)) {
      // Workflow cancelled mid‑run
      updateTask(taskId, (t) => ({ ...t, status: 'cancelled' }));
      workflowTimer.end();
      logExecution({ action: 'workflow_cancel', status: 'cancelled' as any, module: 'orchestrator', taskId });
      incrementCounter('orchestrator.workflow.cancel');
      throw new CancellationError(taskId);
    }
  }

  const duration = Date.now() - start;
  // Final success state
  updateTask(taskId, (t) => ({ ...t, status: 'completed' }));
  await saveCheckpoint(taskId);
  workflowTimer.end();
  logExecution({ action: 'workflow_end', status: 'success', module: 'orchestrator', taskId });
  incrementCounter('orchestrator.workflow.success');

  return {
    taskId,
    success: true,
    stepResults,
    artifacts: [], // populated by steps if needed
    durationMs: duration,
  };
}

/** Cancel a running workflow */
export async function cancelWorkflow(taskId: string): Promise<void> {
  cancelledWorkflows.add(taskId);
  // Update state store immediately
  updateTask(taskId, (t) => ({ ...t, status: 'cancelled' }));
  // No further action needed – running steps will observe the flag
}
