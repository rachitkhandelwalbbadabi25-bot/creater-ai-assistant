// src/runtime/deterministicOrchestration/types.ts
export interface ExecutionStep {
  /** Raw command string for the step */
  command: string;
}

export interface ExecutionPlan {
  steps: ExecutionStep[];
}
