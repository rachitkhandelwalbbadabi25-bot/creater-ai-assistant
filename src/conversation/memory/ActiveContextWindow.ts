// src/conversation/memory/ActiveContextWindow.ts

import { ContextWindow, ConversationState } from "../types";

/** Manage a rolling list of active context windows */
export class ActiveContextWindowManager {
  private static readonly MAX_WINDOWS = 10;

  static pushContext(state: ConversationState, window: ContextWindow): ConversationState {
    const existing = state.activeContexts ?? [];
    const updated = [...existing, window];
    // Keep only top MAX_WINDOWS by relevanceScore (descending)
    updated.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
    const trimmed = updated.slice(0, this.MAX_WINDOWS);
    return { ...state, activeContexts: trimmed };
  }
}
