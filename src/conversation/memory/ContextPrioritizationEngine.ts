// src/conversation/memory/ContextPrioritizationEngine.ts
import { ConversationState, ContextWindow, ActiveContext } from "../types";
import { RelevanceScoringEngine } from "./RelevanceScoringEngine";

/**
 * Light‑weight engine that decides which pieces of conversation context should be
 * kept active for the current turn. It runs deterministic scoring over a few
 * candidate windows (topics, threads, recent entities/goals) and returns a sorted
 * list (high → low relevance).
 */
export class ContextPrioritizationEngine {
  private readonly scorer = new RelevanceScoringEngine();

  /**
   * Generate a prioritized list of context windows based on the supplied state.
   */
  prioritize(state: ConversationState): ContextWindow[] {
    const windows: ContextWindow[] = [];

    // 1️⃣ Topic window (if any current topic)
    if (state.topicState?.currentTopic) {
      windows.push({
        id: `topic-${state.topicState.currentTopic}`,
        summary: `Current topic: ${state.topicState.currentTopic}`,
        lastSeen: Date.now(),
      });
    }

    // 2️⃣ Active thread window
    if (state.threadState?.isActive && state.threadState?.topic) {
      windows.push({
        id: `thread-${state.threadState.id ?? "unknown"}`,
        summary: `Thread on ${state.threadState.topic}`,
        lastSeen: Date.now(),
      });
    }

    // 3️⃣ Recent entities (as a synthetic window)
    if (state.recentEntities && state.recentEntities.length) {
      windows.push({
        id: "recent-entities",
        summary: `Recent entities: ${state.recentEntities.slice(-3).join(", ")}`,
        lastSeen: Date.now(),
      });
    }

    // 4️⃣ Active goals
    if (state.goalState?.unresolvedGoals?.length) {
      windows.push({
        id: "goals",
        summary: `Active goals: ${state.goalState.unresolvedGoals.join(", ")}`,
        lastSeen: Date.now(),
      });
    }

    // Score each window deterministically
    const scored = windows.map((w) => ({
      ...w,
      relevanceScore: this.scorer.computeScore(state, w),
    }));

    // Sort descending by relevanceScore
    scored.sort((a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0));

    // Preserve only the top N windows to keep memory lightweight (e.g., 3)
    const trimmed = scored.slice(0, 3);

    // Map back to ContextWindow (dropping the score property)
    return trimmed.map(({ id, summary, lastSeen }) => ({ id, summary, lastSeen }));
  }
}
