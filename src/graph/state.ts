// ════════════════════════════════════════════════════════════════════════════════
// src/graph/state.ts — Shared conversation state for the multi-agent system
// ════════════════════════════════════════════════════════════════════════════════

import type { Mood, EnergyLevel } from "@emotion/keywords.js";
import type { RuntimeMode } from "../runtime/RuntimeModeClassifier.js";

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
  runtimeMode: RuntimeMode;

  // ── Routing ─────────────────────────────────────────────────────────────────
  intent: string;
  intentConfidence: number;
  targetAgent: string;
  selectedModel: string;

  // ── Emotion ─────────────────────────────────────────────────────────────────
  mood: Mood;
  energy: EnergyLevel;
  emotionConfidence: number;

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
    runtimeMode: "conversational",
    intent: "unknown",
    intentConfidence: 0,
    targetAgent: "",
    selectedModel: "",
    mood: "neutral",
    energy: "medium",
    emotionConfidence: 0,
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
