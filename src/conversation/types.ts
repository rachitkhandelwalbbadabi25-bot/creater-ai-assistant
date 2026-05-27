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
  // *** Response strategy & rendering extensions ***

  // user personality profile for rendering
  personality?: PersonalityProfile;
  // new field for active prioritized contexts
  activeContexts?: ActiveContext[];

  // new cognitive fields
  reasoningBudget?: ReasoningBudget;
  continuityCheckpoint?: ContinuityCheckpoint;
  cognitiveTrace?: CognitiveTrace;
  runtimeEvents?: RuntimeEvent[];
  attentionState?: AttentionState;

  // allow future extensions
  [key: string]: unknown;
}

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

// ---- NEW COGNITIVE TYPES ----
/** Reasoning budget limits deterministic processing */
export interface ReasoningBudget {
  maxContextWindows: number; // how many prioritized contexts to consider
  maxResponseLength: number; // character limit for the final response
}

/** Checkpoint used for continuity recovery */
export interface ContinuityCheckpoint {
  topic: string;
  entities: string[];
  goals: string[];
  lastIntent: string;
}

/** Trace of cognitive steps for observability */
export interface CognitiveTrace {
  steps: string[]; // human‑readable step identifiers
}

/** Generic runtime event for lightweight logging */
export interface RuntimeEvent {
  timestamp: number;
  type: string;
  details: Record<string, unknown>;
}

/** Tracks active attention context and decay */
export interface AttentionState {
  activeContextIds: string[];
  decayRate: number; // per‑turn decay factor (0‑1)
}

/** Result of a continuity recovery attempt */
export interface RecoveryResult {
  success: boolean;
  restoredState?: Partial<ConversationState>;
}

/** Result of a validation operation */
export interface RuntimeValidationResult {
  ok: boolean;
  errors: string[];
}

/** Result of a retrieval validation */
export interface RetrievalValidationResult {
  ok: boolean;
  errors: string[];
}

/** Counters for lightweight runtime metrics */
export interface MetricsCounters {
  reasoningDepthCalls: number;
  contextRetrievalCalls: number;
  continuityRecoveries: number;
  responseGenerations: number;
  invalidStateRecoveries: number;
  fallbackInvocations: number;
  contextPruned: number;
  replaySnapshotsCreated: number;
  transitionCounts: Record<string, number>;
}

/** Snapshot of current metrics */
export interface MetricsSnapshot extends MetricsCounters {}

/** Generic cognitive event for observability */
export interface CognitiveEvent {
  timestamp: number; // deterministic monotonic counter
  type: string;
  details: Record<string, unknown>;
}

/** Record of a state transition */
export interface StateTransitionRecord {
  transition: string;
  from: string; // could be a serialized state identifier
  to: string;
  reason: string;
}


