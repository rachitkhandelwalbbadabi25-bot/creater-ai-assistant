// src/runtime/semantic/semanticExecutionPolicy.ts
export enum ExecutionModeEnum {
  DETERMINISTIC = "deterministic",
  VALIDATION = "validation",
  CONVERSATION = "conversation",
}

/**
 * Determines the execution mode based on confidence of the semantic payload.
 * Returns "deterministic" for high confidence, "validation" for moderate, and
 * "conversation" for low confidence.
 */
export function determineExecutionMode(confidence: number): ExecutionModeEnum {
  if (confidence >= 0.90) return ExecutionModeEnum.DETERMINISTIC;
  if (confidence >= 0.70) return ExecutionModeEnum.VALIDATION;
  return ExecutionModeEnum.CONVERSATION;
}
