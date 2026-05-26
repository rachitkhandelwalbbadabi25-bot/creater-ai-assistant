// packages/convo/src/state/ConversationStateEngine.ts

import {
  UserMessage,
  Intent,
  ConversationState,
  TopicState,
  GoalState,
  ThreadState,
  InteractionMode,
  ReasoningDepth,
} from "../types";

/** Simple deterministic UUID v4 replacement – sufficient for Phase 1 */
function genId(): string {
  return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
}

/**
 * ConversationStateEngine – Phase 2 implementation.
 *
 * Provides a deterministic in‑memory store plus rich helpers for:
 *   • Topic tracking & transitions
 *   • Interaction‑mode inference
 *   • Goal lifecycle management
 *   • Reasoning‑depth adaptation
 *   • Thread management & branching
 *   • Light‑weight short‑term memory (recent intents / entities)
 */
export class ConversationStateEngine {
  /** In‑memory map userId → ConversationState */
  private readonly store = new Map<string, ConversationState>();

  /** Initialise a brand‑new state for a user */
  initState(userId: string, msg: UserMessage): ConversationState {
    const baseState: ConversationState = {
      turnId: genId(),
      userId,
      lastMessage: msg,
      // default tracking structures
      topicState: {
        currentTopic: "",
        previousTopics: [],
        transitions: {},
      },
      interactionMode: "casual",
      reasoningDepth: "lightweight",
      goalState: {
        unresolvedGoals: [],
        completedGoals: [],
      },
      threadState: {
        id: genId(),
        topic: "",
        isActive: true,
        messages: [],
      },
      recentIntents: [],
      recentEntities: [],
    };
    this.store.set(userId, baseState);
    return baseState;
  }

  /** Retrieve existing state */
  getState(userId: string): ConversationState | undefined {
    return this.store.get(userId);
  }

  /** Update the stored state with a new intent and derive higher‑level signals */
  updateIntent(state: ConversationState, intent: Intent): ConversationState {
    // ----- Update intent & turn -----
    const updated: ConversationState = {
      ...state,
      intent,
      turnId: genId(),
    };

    // ----- Recent intents sliding window (max 5) -----
    const recent = (updated.recentIntents ?? []).slice(-4);
    recent.push(intent);
    updated.recentIntents = recent;

    // ----- Interaction mode inference -----
    updated.interactionMode = this.inferMode(intent);

    // ----- Reasoning depth adaptation -----
    updated.reasoningDepth = this.adaptReasoningDepth(updated);

    // ----- Store back -----
    this.store.set(state.userId, updated);
    return updated;
  }

  /** Infer an InteractionMode from a detected intent */
  private inferMode(intent: Intent): InteractionMode {
    const name = intent.name.toLowerCase();
    if (name.includes("greet") || name.includes("smalltalk")) return "casual";
    if (name.includes("tech") || name.includes("code") || name.includes("api")) return "technical";
    if (name.includes("brainstorm")) return "brainstorming";
    if (name.includes("feel") || name.includes("emotion")) return "emotional";
    if (name.includes("plan")) return "planning";
    if (name.includes("execute") || name.includes("run")) return "execution";
    return "casual"; // fallback
  }

  /** Adjust reasoning depth based on context cues */
  private adaptReasoningDepth(state: ConversationState): ReasoningDepth {
    // Example heuristics – can be refined later
    const msgLength = state.lastMessage?.text?.length ?? 0;
    const confidence = state.intent?.confidence ?? 1;

    if (msgLength > 200 || confidence < 0.6) return "deep";
    if (msgLength > 100) return "analytical";
    if (msgLength > 50) return "normal";
    return "lightweight";
  }

  /** Track topic transitions */
  setTopic(state: ConversationState, newTopic: string): ConversationState {
    const topic = state.topicState ?? {
      currentTopic: "",
      previousTopics: [],
      transitions: {},
    };

    // Record transition
    if (topic.currentTopic && topic.currentTopic !== newTopic) {
      // push previous
      topic.previousTopics.push(topic.currentTopic);
      // record map
      if (!topic.transitions) {
        topic.transitions = {};
      }
      if (!topic.transitions[topic.currentTopic]) {
        topic.transitions[topic.currentTopic] = [];
      }
      if (!topic.transitions[topic.currentTopic].includes(newTopic)) {
        topic.transitions[topic.currentTopic].push(newTopic);
      }
    }
    topic.currentTopic = newTopic;
    const updated = { ...state, topicState: topic, turnId: genId() };
    this.store.set(state.userId, updated);
    return updated;
  }

  /** Goal handling – add, complete, clear */
  addGoal(state: ConversationState, goal: string): ConversationState {
    const goalState = state.goalState ?? { unresolvedGoals: [], completedGoals: [] };
    if (!goalState.unresolvedGoals.includes(goal) && !goalState.completedGoals.includes(goal)) {
      goalState.unresolvedGoals.push(goal);
    }
    const updated = { ...state, goalState, turnId: genId() };
    this.store.set(state.userId, updated);
    return updated;
  }

  completeGoal(state: ConversationState, goal: string): ConversationState {
    const goalState = state.goalState ?? { unresolvedGoals: [], completedGoals: [] };
    // Remove from unresolved if present
    goalState.unresolvedGoals = goalState.unresolvedGoals.filter((g) => g !== goal);
    if (!goalState.completedGoals.includes(goal)) {
      goalState.completedGoals.push(goal);
    }
    const updated = { ...state, goalState, turnId: genId() };
    this.store.set(state.userId, updated);
    return updated;
  }

  /** Thread management – switch, resume, interrupt */
  startThread(state: ConversationState, topic: string): ConversationState {
    const thread: ThreadState = {
      id: genId(),
      topic,
      isActive: true,
      messages: [],
    };
    const updated = { ...state, threadState: thread, turnId: genId() };
    this.store.set(state.userId, updated);
    return updated;
  }

  /** Append a message to the active thread */
  appendToThread(state: ConversationState, messageId: string): ConversationState {
    const thread = state.threadState;
    if (thread && thread.isActive) {
      if (!thread.messages) {
        thread.messages = [];
      }
      thread.messages.push(messageId);
    }
    const updated = { ...state, threadState: thread, turnId: genId() };
    this.store.set(state.userId, updated);
    return updated;
  }

  /** Interrupt current thread – mark inactive */
  interruptThread(state: ConversationState): ConversationState {
    if (state.threadState) {
      state.threadState.isActive = false;
    }
    const updated = { ...state, turnId: genId() };
    this.store.set(state.userId, updated);
    return updated;
  }

  /** Helper to retrieve the short‑term memory snapshot */
  snapshot(state: ConversationState) {
    return {
      recentIntents: state.recentIntents,
      recentEntities: state.recentEntities,
      topicState: state.topicState,
      interactionMode: state.interactionMode,
      reasoningDepth: state.reasoningDepth,
      goalState: state.goalState,
      threadState: state.threadState,
    };
  }
}
