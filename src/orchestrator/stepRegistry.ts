// src/orchestrator/stepRegistry.ts

/**
 * Simple in‑memory registry for workflow step handlers.
 * A handler receives a WorkflowStep and returns a Promise resolving to a StepResult.
 */
export type StepHandler = (step: WorkflowStep) => Promise<StepResult>;

export interface WorkflowStep {
  id: string;
  agent: string;
  action: string;
  args: Record<string, unknown>;
  dependsOn?: string[];
  timeoutMs?: number;
  compensate?: WorkflowStep;
}

export interface StepResult {
  stepId: string;
  success: boolean;
  output?: unknown;
  artifacts?: unknown[];
  error?: unknown;
  durationMs: number;
}

const registry = new Map<string, StepHandler>();

/** Register a handler for a step identifier */
export function registerStepHandler(stepId: string, handler: StepHandler): void {
  registry.set(stepId, handler);
}

/** Retrieve a handler for a step identifier */
export function getStepHandler(stepId: string): StepHandler | undefined {
  return registry.get(stepId);
}

/** Check if a handler exists for a step identifier */
export function hasStepHandler(stepId: string): boolean {
  return registry.has(stepId);
}

/** Remove a handler for a step identifier */
export function removeStepHandler(stepId: string): void {
  registry.delete(stepId);
}
