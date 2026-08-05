export class OrchestratorError extends Error {
  constructor(message: string, public code: string = 'ORCHESTRATOR_ERROR') {
    super(message);
    this.name = 'OrchestratorError';
  }
}

export class CircularDependencyError extends OrchestratorError {
  constructor(message: string = 'Circular dependency detected') {
    super(message, 'CIRCULAR_DEPENDENCY');
    this.name = 'CircularDependencyError';
  }
}

export class StepTimeoutError extends OrchestratorError {
  constructor(stepId: string) {
    super(`Step ${stepId} timed out`, 'STEP_TIMEOUT');
    this.name = 'StepTimeoutError';
  }
}

export class CancellationError extends OrchestratorError {
  constructor(taskId: string) {
    super(`Workflow ${taskId} was cancelled`, 'CANCELLED');
    this.name = 'CancellationError';
  }
}
