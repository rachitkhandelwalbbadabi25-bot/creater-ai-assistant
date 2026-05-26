import { ConversationState, ActiveContext, ResponseStrategy, RuntimeValidationResult } from '../types';

/** Validate the overall conversation state */
export function validateConversationState(state: ConversationState): RuntimeValidationResult {
  const errors: string[] = [];
  if (!state.turnId) errors.push('turnId missing');
  if (!state.userId) errors.push('userId missing');
  if (!state.lastMessage) errors.push('lastMessage missing');
  // optional fields can be undefined – no error
  return { ok: errors.length === 0, errors };
}

/** Validate a single active context against the conversation state */
export function validateActiveContext(context: ActiveContext, state: ConversationState): RuntimeValidationResult {
  const errors: string[] = [];
  if (!context.id) errors.push('ActiveContext.id missing');
  if (typeof context.relevance !== 'number') errors.push('ActiveContext.relevance must be a number');
  // ensure the context belongs to the current state if a list exists
  if (state.activeContexts && !state.activeContexts.find(c => c.id === context.id)) {
    errors.push('ActiveContext not present in state.activeContexts');
  }
  return { ok: errors.length === 0, errors };
}

/** Validate response strategy */
export function validateResponseStrategy(strategy: ResponseStrategy): RuntimeValidationResult {
  const errors: string[] = [];
  if (!strategy.type) errors.push('ResponseStrategy.type missing');
  // depth and style are optional but if provided must be strings
  if (strategy.depth && typeof strategy.depth !== 'number') errors.push('ResponseStrategy.depth must be a number');
  if (strategy.style && typeof strategy.style !== 'string') errors.push('ResponseStrategy.style must be a string');
  return { ok: errors.length === 0, errors };
}
