// src/runtime/deterministicOrchestration/types.ts
// ─── Execution Plan ──────────────────────────────────────────────────────────

/** A single resolved step in a deterministic execution plan */
export interface ExecutionStep {
  /** Raw command string as typed by the user */
  command: string;
}

/** An ordered list of steps to execute sequentially */
export interface ExecutionPlan {
  steps: ExecutionStep[];
}

// ─── Workflow Status ──────────────────────────────────────────────────────────

export type WorkflowStatus =
  | "pending"
  | "running"
  | "completed"
  | "partial_success"
  | "failed";

// ─── Step Result ─────────────────────────────────────────────────────────────

/** The outcome of a single executed step */
export interface StepResult {
  stepIndex: number;
  command: string;
  toolId: string;
  success: boolean;
  message: string;
  durationMs: number;
  error?: string;
  data?: unknown;
}

// ─── Execution State ─────────────────────────────────────────────────────────

/** Shared mutable state threaded through the entire workflow */
export interface ExecutionState {
  /** Total number of steps in the plan */
  totalSteps: number;
  /** Zero-based index of the step currently executing */
  currentStep: number;
  /** Results of all steps that have completed (success or failure) */
  stepResults: StepResult[];
  /** Commands of steps that succeeded */
  completedSteps: string[];
  /** Command of the first failed step, if any */
  failedStep: string | null;
  /** Current lifecycle phase of the workflow */
  status: WorkflowStatus;
  /** Epoch ms when the workflow started */
  startTime: number;
  /** Epoch ms when the workflow finished (0 while running) */
  endTime: number;
  /** Lightweight shared browser execution state */
  browserState?: {
    isLaunched: boolean;
    activeContext: boolean;
    currentUrl: string | null;
  };
}

// ─── Workflow Result ──────────────────────────────────────────────────────────

/** Final aggregated result returned to the supervisor */
export interface WorkflowResult {
  status: WorkflowStatus;
  summary: string;
  stepResults: StepResult[];
  totalDurationMs: number;
}

// ─── Lifecycle Log Labels ─────────────────────────────────────────────────────

export enum DeterministicExecutionLog {
  WORKFLOW_START    = "EXECUTION WORKFLOW START",
  STEP_START        = "EXECUTION STEP START",
  STEP_RESULT       = "EXECUTION STEP RESULT",
  STATE_UPDATED     = "EXECUTION STATE UPDATED",
  WORKFLOW_COMPLETE = "EXECUTION WORKFLOW COMPLETE",
  WORKFLOW_FAILED   = "EXECUTION WORKFLOW FAILED",
}
