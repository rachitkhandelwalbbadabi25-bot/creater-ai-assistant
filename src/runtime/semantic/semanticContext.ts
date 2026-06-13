// src/runtime/semantic/semanticContext.ts

import type { SemanticPayload } from "./semanticPayload.js";

export interface SemanticContext {
  payload: SemanticPayload;
  requestId: string;
  timing?: {
    extractionMs?: number;
    routingMs?: number;
    executionMs?: number;
  };
}

/**
 * Helper to create a SemanticContext for a given payload.
 * No persistence or memory storage – purely runtime state.
 */
export function createSemanticContext(payload: SemanticPayload, requestId: string): SemanticContext {
  return {
    payload,
    requestId,
    timing: {},
  };
}
