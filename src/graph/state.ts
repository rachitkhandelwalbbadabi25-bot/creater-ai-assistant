// ════════════════════════════════════════════════════════════════════════════════
// src/graph/state.ts — Shared conversation state for the multi-agent system
// ════════════════════════════════════════════════════════════════════════════════

import type { Mood, EnergyLevel } from "@emotion/keywords.js";

/** A single message in the conversation */
export interface ConversationMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
  timestamp: number;
}

/** Current step in the agent pipeline */
export type AgentStep = "routing" | "planning" | "executing" | "responding" | "done" | "error";

/** The shared state passed between all agents */
export interface GraphState {
  // ── Conversation ────────────────────────────────────────────────────────────
  messages: ConversationMessage[];
  currentInput: string;
  channel: "tui" | "telegram" | "web" | "voice";

  // ── Routing ─────────────────────────────────────────────────────────────────
  intent: string;
  intentConfidence: number;
  targetAgent: string;
  selectedModel: string;
  // Execution bypass flags – set when deterministic execution is detected
  skipConversationPipeline: boolean;
  skipEmotionPipeline: boolean;
  skipSemanticRetrieval: boolean;
  // New flag to explicitly disable any conversational fallback when in execution mode
  allowConversationalFallback: boolean;
  executionSource?: "alias" | "semantic-search" | "direct-launch" | "system-command";

  // ── Emotion ─────────────────────────────────────────────────────────────────
  mood: Mood;
  energy: EnergyLevel;
  emotionConfidence: number;
  emotionContextTier?: "simple" | "deep" | "analysis";

  // ── Execution ───────────────────────────────────────────────────────────────
  currentStep: AgentStep;
  plan: string[];
  toolResults: Array<{ toolId: string; result: string; success: boolean }>;
  requiresConfirmation: boolean;
  pendingConfirmation?: { toolId: string; params: Record<string, unknown>; reason: string };

  // ── Output ──────────────────────────────────────────────────────────────────
  response: string;
  error?: string;

  // ── Context ─────────────────────────────────────────────────────────────────
  contextBlock: string;
  memoryRetrieved: boolean;
  onToken?: (token: string) => void;
}

/** Create a fresh initial state for a new user message */
export function createInitialState(
  input: string,
  channel: GraphState["channel"] = "tui"
): GraphState {
  return {
    messages: [{ role: "user", content: input, timestamp: Date.now() }],
    currentInput: input,
    channel,
    intent: "unknown",
    intentConfidence: 0,
    targetAgent: "",
    selectedModel: "",
    mood: "neutral",
    energy: "medium",
    emotionConfidence: 0,
    emotionContextTier: "simple",
    // execution bypass defaults
    skipConversationPipeline: false,
    skipEmotionPipeline: false,
    skipSemanticRetrieval: false,
    // allow conversational fallback by default
    allowConversationalFallback: true,
    executionSource: undefined,
    currentStep: "routing",
    plan: [],
    toolResults: [],
    requiresConfirmation: false,
    response: "",
    contextBlock: "",
    memoryRetrieved: false,
  };
}

/** Append a message to state (immutable — returns new state) */
export function addMessageToState(
  state: GraphState,
  role: ConversationMessage["role"],
  content: string
): GraphState {
  return {
    ...state,
    messages: [...state.messages, { role, content, timestamp: Date.now() }],
  };
}
