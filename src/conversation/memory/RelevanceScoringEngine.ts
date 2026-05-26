// src/conversation/memory/RelevanceScoringEngine.ts
import { ConversationState, ContextWindow } from "../types";

/**
 * Deterministic scoring engine used by ContextPrioritizationEngine.
 * The scoring combines simple heuristics that are cheap to compute and
 * produce a reproducible relevance value between 0 and 1.
 */
export class RelevanceScoringEngine {
  /**
   * Compute a relevance score for a given context window.
   * The algorithm is deliberately lightweight – it avoids any async I/O or
   * heavy computation. Scores are derived from:
   *   • Recency (how recent the last user message is)
   *   • Topic overlap (if the window concerns the current topic)
   *   • Entity overlap (if recent entities appear in the window summary)
   *   • Goal alignment (if unresolved goals are mentioned)
   *   • Interaction‑mode similarity (very small boost when mode is set)
   * All sub‑scores are weighted and summed, then clamped to [0,1].
   */
  computeScore(state: ConversationState, window: ContextWindow): number {
    const now = Date.now();
    // Recency – newer lastMessage gives higher score (max 0.3)
    const recency = state.lastMessage?.timestamp
      ? Math.max(0, 1 - (now - state.lastMessage.timestamp) / (1000 * 60 * 60)) // within hour
      : 0;
    const recencyScore = recency * 0.3;

    // Topic overlap – boost if window id contains current topic identifier
    const currentTopic = state.topicState?.currentTopic ?? "";
    const topicScore = window.id.includes(currentTopic) ? 0.2 : 0;

    // Entity overlap – proportion of recent entities mentioned in the summary
    const recentEntities = state.recentEntities ?? [];
    const entityMatches = recentEntities.filter((e) => window.summary.includes(e)).length;
    const entityScore = recentEntities.length ? (entityMatches / recentEntities.length) * 0.15 : 0;

    // Goal alignment – similar to entities but for unresolved goals
    const unresolvedGoals = state.goalState?.unresolvedGoals ?? [];
    const goalMatches = unresolvedGoals.filter((g) => window.summary.includes(g)).length;
    const goalScore = unresolvedGoals.length ? (goalMatches / unresolvedGoals.length) * 0.2 : 0;

    // Interaction‑mode similarity – small constant boost when a mode is set
    const modeScore = state.interactionMode ? 0.1 : 0;

    // Combine and clamp
    const total = recencyScore + topicScore + entityScore + goalScore + modeScore;
    return Math.min(1, Math.max(0, total));
  }
}
