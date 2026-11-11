// ════════════════════════════════════════════════════════════════════════════════
// src/workflow/types.ts — Workflow Engine Domain Model (Phase 6.1)
// Represents multi-step workflow states, steps, contexts, and errors.
// ════════════════════════════════════════════════════════════════════════════════

export type WorkflowStatus =
  | "PENDING"
  | "RUNNING"
  | "PAUSED"
  | "WAITING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type StepStatus =
  | "PENDING"
  | "RUNNING"
  | "WAITING"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED"
  | "CANCELLED"
  | "UNKNOWN";

export type StepType = "TOOL" | "ACTION" | "CONDITION" | "WAIT" | "PARALLEL" | "BRANCH";

export interface WorkflowStepInput {
  toolId?: string;
  params?: Record<string, unknown>;
  actionName?: string;
  actionFn?: (context: WorkflowExecutionContext) => unknown | Promise<unknown>;
  conditionFn?: (context: WorkflowExecutionContext) => boolean | Promise<boolean>;
  conditionExpr?: string;
  durationMs?: number;
  resumeAt?: number;
  thenStepId?: string;
  elseStepId?: string;
  maxConcurrency?: number;
  parallelSteps?: WorkflowStep[];
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: StepType;
  status: StepStatus;
  input: WorkflowStepInput;
  dependsOn?: string[];
  output?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  retryCount: number;
  metadata?: Record<string, unknown>;
}

export interface WorkflowExecutionContext {
  workflowId: string;
  correlationId: string;
  stepResults: Record<string, unknown>;
  variables: Record<string, unknown>;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  steps: WorkflowStep[];
  currentStepIndex: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface StepClaim {
  workflowId: string;
  stepId: string;
  executionId: string;
  claimedAt: number;
  holder?: string;
}

export interface RecoveryOptions {
  autoRetryReadonly?: boolean;
}

export interface WorkflowRecoveryResult {
  recoveredCount: number;
  failedCount: number;
  unknownCount: number;
  workflows: Workflow[];
}

export type WorkflowErrorCode =
  | "VALIDATION_ERROR"
  | "EXECUTION_ERROR"
  | "TIMEOUT_ERROR"
  | "SAFETY_ERROR"
  | "CANCELLED_ERROR"
  | "DEPENDENCY_ERROR"
  | "CONCURRENCY_ERROR"
  | "RECOVERY_ERROR"
  | "UNKNOWN_ERROR";

export class WorkflowError extends Error {
  code: WorkflowErrorCode;
  workflowId: string;
  stepId?: string;
  details?: unknown;

  constructor(
    message: string,
    code: WorkflowErrorCode,
    workflowId: string,
    stepId?: string,
    details?: unknown
  ) {
    super(message);
    this.name = "WorkflowError";
    this.code = code;
    this.workflowId = workflowId;
    this.stepId = stepId;
    this.details = details;
  }
}

export interface CreateWorkflowParams {
  id?: string;
  name: string;
  description?: string;
  steps: Array<{
    id?: string;
    name: string;
    type: StepType;
    input: WorkflowStepInput;
    dependsOn?: string[];
    metadata?: Record<string, unknown>;
  }>;
  metadata?: Record<string, unknown>;
}
