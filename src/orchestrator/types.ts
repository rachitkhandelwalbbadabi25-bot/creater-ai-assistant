export interface WorkflowStep {
  id: string;
  agent: string; // identifier of the MCP agent to invoke (e.g., "browser", "filesystem", "os")
  action: string; // name of the action function in the MCP module
  args: Record<string, unknown>;
  dependsOn?: string[];
  timeoutMs?: number;
  compensate?: WorkflowStep; // optional compensation step to run on failure
  compensateFn?: (taskId: string, stepId: string) => Promise<void>; // inline compensation function
  retries?: number; // number of retry attempts
  backoffMs?: number; // backoff delay between retries in ms
  hooks?: {
    onBefore?: string;
    onAfter?: string;
  };
}

export interface WorkflowArtifact {
  id: string;
  type: string;
  data: unknown;
  metadata?: Record<string, unknown>;
}

export interface HookPayload {
  stepId: string;
  taskId: string;
  data: unknown;
  timestamp: number;
}

export interface WorkflowDefinition {
  taskId: string;
  name: string;
  steps: WorkflowStep[];
}

export interface StepResult {
  stepId: string;
  success: boolean;
  output?: unknown;
  artifacts?: WorkflowArtifact[];
  error?: unknown;
  durationMs: number;
}

export interface WorkflowResult {
  taskId: string;
  success: boolean;
  stepResults: StepResult[];
  artifacts: WorkflowArtifact[];
  durationMs: number;
}

export type WorkflowStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowStartedPayload {
  taskId: string;
  correlationId?: string;
  name?: string;
  timestamp: number;
}

export interface WorkflowCompletedPayload {
  taskId: string;
  success: boolean;
  timestamp: number;
}

export interface WorkflowFailedPayload {
  taskId: string;
  error: unknown;
  timestamp: number;
}

export interface WorkflowCancelledPayload {
  taskId: string;
  timestamp: number;
}
