// ════════════════════════════════════════════════════════════════════════════════
// src/graph/taskAgent.ts — Handles task management, Q&A, scheduling, memory queries
// ════════════════════════════════════════════════════════════════════════════════

import type { GraphState } from "./state.js";
import { chat, type ChatMessage } from "@llm/ollama.js";
import { SYSTEM_PROMPT } from "@llm/prompts.js";
import { GenerationPresets } from "@config/models.js";
import { addMessage, getChatHistory } from "@memory/shortTerm.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("graph/taskAgent");

export async function taskAgentNode(state: GraphState): Promise<GraphState> {
  log.info(`TaskAgent handling intent: ${state.intent}`);

  const history = getChatHistory(8);
  const messages: ChatMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${state.contextBlock}` },
    ...history.map(m => ({ role: m.role as ChatMessage["role"], content: m.content })),
    { role: "user", content: state.currentInput },
  ];

  const preset = state.intent.includes("code") ? GenerationPresets.coding
    : state.intent === "chitchat" ? GenerationPresets.conversational
    : GenerationPresets.precise;

  const response = await chat({
    model: state.selectedModel,
    messages,
    options: preset,
  });

  // Persist to memory
  addMessage("user", state.currentInput, state.channel, {
    emotion: state.mood, intent: state.intent,
  });
  addMessage("assistant", response, state.channel);

  return { ...state, response, currentStep: "done" };
}
