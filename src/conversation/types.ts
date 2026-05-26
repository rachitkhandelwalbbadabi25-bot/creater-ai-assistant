/* packages/convo/src/types.ts */

/** Core data structures for the conversational runtime **/
export interface UserMessage {
  id: string; // unique user/session identifier
  timestamp: number;
  text: string;
}

/** Detected intent **/
export interface Intent {
  name: string;
  confidence: number; // 0.0 – 1.0 confidence score
  entities: Record<string, unknown>;
}

/*** Extended state‑tracking types ***/
export type InteractionMode =
  | "casual"
  | "technical"
  | "brainstorming"
  | "emotional"
  | "planning"
  | "execution";

export type ReasoningDepth = "lightweight" | "normal" | "analytical" | "deep";

export interface TopicState {
  currentTopic?: string;
  previousTopics: string[];
  transitions?: Record<string, string[]>;
}

export interface GoalState {
  currentGoal?: string;
  unresolvedGoals: string[];
  completedGoals: string[];
}

export interface ContinuityState {
  lastIntents: string[]; // recent intent names, capped
  recentEntities: string[]; // flattened entity keys
}

export interface ThreadInfo {
  topic?: string;
  messages: string[]; // ids or short summaries belonging to the thread
  summary?: string; // brief thread summary for quick retrieval
}

export interface ThreadState {
  id?: string;
  topic?: string;
  isActive?: boolean;
  messages?: string[];
  activeThreadId?: string;
  threads?: Record<string, ThreadInfo>;
}

export interface ShortTermMemory {
  recentMessageSummaries: string[]; // textual summaries of recent turns
  recentEntitiesMemory: string[]; // entity names remembered short‑term
}

/*** New memory‑prioritisation types ***/
export interface ContextWindow {
  id: string;
  summary: string;
  lastSeen: number; // timestamp of the most recent activity in this window
  relevanceScore?: number;
}

export interface RelevanceScore {
  contextId: string;
  score: number;
}

export interface MemorySnapshot {
  recentSummaries: string[];
  recentEntities: string[];
  recentGoals: string[];
  activeThreads: ContextWindow[];
}

export type ContextPriority = "high" | "medium" | "low";

export interface RetrievalResult {
  contextId: string;
  summary: string;
}

export interface ActiveContext {
  id: string;
  relevance: number;
}

export interface ConversationState {
  turnId: string;
  userId: string;
  lastMessage: UserMessage;
  intent?: Intent;

  // --- Extended tracking fields (optional, ready for Phase‑2) ---
  topicState?: TopicState;
  interactionMode?: InteractionMode;
  goalState?: GoalState;
  reasoningDepth?: ReasoningDepth;
  continuity?: ContinuityState;
  threadState?: ThreadState;
  shortTermMemory?: ShortTermMemory;
  recentIntents?: Intent[];
  recentEntities?: string[];
  personality?: PersonalityProfile;

  // new field for active prioritized contexts
  activeContexts?: ActiveContext[];

  // allow future extensions
  [key: string]: unknown;
}

/*** Response strategy & rendering extensions ***/
export type ResponseDepth = ReasoningDepth;

export type ResponseStyle =
  | "concise"
  | "analytical"
  | "collaborative"
  | "emotional"
  | "clarification"
  | "planning"
  | "technical"
  | "execution";

export interface RenderContext {
  personality?: PersonalityProfile;
  depth: ResponseDepth;
  style: ResponseStyle;
  interactionMode?: InteractionMode;
  currentGoal?: string;
}

export interface ResponseStrategy {
  type: "direct" | "fallback" | "escalate";
  payload?: unknown;
  depth?: ResponseDepth;
  style?: ResponseStyle;
}

export interface PersonalityProfile {
  name: string;
  tone: "formal" | "casual" | "friendly" | "professional";
}

export interface RenderedResponse {
  text: string;
  meta?: Record<string, unknown>;
}
