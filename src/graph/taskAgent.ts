// ════════════════════════════════════════════════════════════════════════════════
// src/graph/taskAgent.ts — Handles task management, Q&A, scheduling, memory queries
// ════════════════════════════════════════════════════════════════════════════════

import type { GraphState } from "./state.js";
import { chat, chatStream, type ChatMessage } from "@llm/client.js";
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

  let response = "";
  if (state.onToken) {
    response = await chatStream(
      {
        model: state.selectedModel,
        messages,
        options: preset,
      },
      state.onToken
    );
  } else {
    response = await chat({
      model: state.selectedModel,
      messages,
      options: preset,
    });
  }

  // Persist to memory
  addMessage("user", state.currentInput, state.channel, {
    emotion: state.mood, intent: state.intent,
  });
  addMessage("assistant", response, state.channel);

  // ── Long-term persistence (Vector RAG) ──────────────────────────────────────
  // We save the interaction if it's meaningful
  if (state.intent !== "chitchat" && response.length > 20) {
    import("@memory/vector.js").then(({ addEntry }) => {
      addEntry(`User: ${state.currentInput}\nCreater: ${response}`, {
        intent: state.intent,
        mood: state.mood,
        timestamp: new Date().toISOString()
      });
    });
  }

  return { ...state, response, currentStep: "done" };
}
