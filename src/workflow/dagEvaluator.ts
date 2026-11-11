// ════════════════════════════════════════════════════════════════════════════════
// src/workflow/dagEvaluator.ts — DAG Evaluator & Cycle Detector (Phase 6.4)
// Deterministic DAG validation, dependency checking, and readiness solver.
// ════════════════════════════════════════════════════════════════════════════════

import type { Workflow, WorkflowStep } from "./types.js";
import { WorkflowError } from "./types.js";

/**
 * Validates DAG structure for a workflow.
 * Throws a clear WorkflowError if the workflow contains malformed dependencies,
 * self-dependencies, invalid branch targets, or cycles.
 */
export function validateDag(workflow: Workflow): void {
  if (!workflow || !Array.isArray(workflow.steps)) {
    throw new WorkflowError("Workflow validation failed: steps must be an array.", "VALIDATION_ERROR", workflow?.id || "unknown");
  }

  const stepIds = new Set<string>();
  const stepMap = new Map<string, WorkflowStep>();

  // 1. Check duplicate step IDs
  for (const step of workflow.steps) {
    if (!step.id || typeof step.id !== "string" || step.id.trim() === "") {
      throw new WorkflowError("Workflow step missing valid 'id'.", "VALIDATION_ERROR", workflow.id);
    }
    if (stepIds.has(step.id)) {
      throw new WorkflowError(`Duplicate step ID detected: '${step.id}'`, "VALIDATION_ERROR", workflow.id, step.id);
    }
    stepIds.add(step.id);
    stepMap.set(step.id, step);
  }

  // 2. Validate dependsOn IDs, self-dependencies, and branch targets
  for (const step of workflow.steps) {
    if (step.dependsOn && Array.isArray(step.dependsOn)) {
      for (const depId of step.dependsOn) {
        if (depId === step.id) {
          throw new WorkflowError(`Self-dependency detected on step '${step.id}'.`, "VALIDATION_ERROR", workflow.id, step.id);
        }
        if (!stepIds.has(depId)) {
          throw new WorkflowError(
            `Missing dependency ID '${depId}' specified in step '${step.id}'.`,
            "VALIDATION_ERROR",
            workflow.id,
            step.id
          );
        }
      }
    }

    if (step.type === "BRANCH") {
      if (step.input.thenStepId && !stepIds.has(step.input.thenStepId)) {
        throw new WorkflowError(
          `BRANCH step '${step.id}' references non-existent thenStepId '${step.input.thenStepId}'.`,
          "VALIDATION_ERROR",
          workflow.id,
          step.id
        );
      }
      if (step.input.elseStepId && !stepIds.has(step.input.elseStepId)) {
        throw new WorkflowError(
          `BRANCH step '${step.id}' references non-existent elseStepId '${step.input.elseStepId}'.`,
          "VALIDATION_ERROR",
          workflow.id,
          step.id
        );
      }
    }
  }

  // 3. Detect cycles
  detectCycles(workflow);
}

/**
 * Deterministically checks for circular dependencies in a workflow step graph using DFS.
 * Throws WorkflowError if a cycle is found.
 */
export function detectCycles(workflow: Workflow): void {
  const stepMap = new Map<string, WorkflowStep>();
  for (const step of workflow.steps) {
    stepMap.set(step.id, step);
  }

  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  function dfs(stepId: string, path: string[]) {
    visited.add(stepId);
    recursionStack.add(stepId);

    const step = stepMap.get(stepId);
    if (step && step.dependsOn && Array.isArray(step.dependsOn)) {
      for (const depId of step.dependsOn) {
        if (!visited.has(depId)) {
          dfs(depId, [...path, depId]);
        } else if (recursionStack.has(depId)) {
          const cyclePath = [...path, depId].join(" -> ");
          throw new WorkflowError(
            `Circular dependency detected: ${cyclePath}`,
            "VALIDATION_ERROR",
            workflow.id,
            stepId
          );
        }
      }
    }

    recursionStack.delete(stepId);
  }

  for (const step of workflow.steps) {
    if (!visited.has(step.id)) {
      dfs(step.id, [step.id]);
    }
  }
}

/**
 * Returns all PENDING steps that are ready for execution because all their `dependsOn`
 * dependencies have reached terminal status (COMPLETED or SKIPPED).
 */
export function getExecutableSteps(workflow: Workflow): WorkflowStep[] {
  const stepMap = new Map<string, WorkflowStep>();
  for (const step of workflow.steps) {
    stepMap.set(step.id, step);
  }

  const executable: WorkflowStep[] = [];

  for (const step of workflow.steps) {
    if (step.status !== "PENDING") {
      continue;
    }

    // Step with no dependencies is immediately executable
    if (!step.dependsOn || step.dependsOn.length === 0) {
      executable.push(step);
      continue;
    }

    // Check if all parent dependencies are COMPLETED or SKIPPED
    let dependenciesSatisfied = true;
    let hasCompletedDependency = false;

    for (const depId of step.dependsOn) {
      const parentStep = stepMap.get(depId);
      if (!parentStep) {
        dependenciesSatisfied = false;
        break;
      }

      if (parentStep.status !== "COMPLETED" && parentStep.status !== "SKIPPED") {
        dependenciesSatisfied = false;
        break;
      }

      if (parentStep.status === "COMPLETED") {
        hasCompletedDependency = true;
      }
    }

    if (dependenciesSatisfied) {
      // If ALL dependencies were SKIPPED (and none completed), this node is unreachable and should be skipped rather than executed.
      // However, if at least one dependency completed (or step had mixed dependencies), it is executable.
      executable.push(step);
    }
  }

  return executable;
}
