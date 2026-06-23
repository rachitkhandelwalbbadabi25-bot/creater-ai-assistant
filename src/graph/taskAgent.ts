// ════════════════════════════════════════════════════════════════════════════════
// src/graph/taskAgent.ts — Handles task management, Q&A, scheduling, memory queries
// ════════════════════════════════════════════════════════════════════════════════

import type { GraphState } from "./state.js";
import { chat, chatStream, type ChatMessage } from "@llm/client.js";
import { OPTIMIZED_SYSTEM_PROMPT } from "@llm/prompts.js";
import { GenerationPresets } from "@config/models.js";
import { DEFAULT_NUM_CTX } from "@llm/constants.js";
import { getNumPredict } from "@llm/tokenBudget.js";
import { addMessage, getChannelChatHistory } from "@memory/shortTerm.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("graph/taskAgent");

function trimHistoryContent(content: string): string {
  return content.length > 500 ? `${content.slice(0, 500)}...` : content;
}

export async function taskAgentNode(state: GraphState): Promise<GraphState> {
  log.info(`TaskAgent handling intent: ${state.intent}`);

  const isConversational = state.intent === "chitchat" || state.intent === "conversation";
  const historyLimit = isConversational ? 2 : state.memoryRetrieved ? 4 : 2;
  const history = getChannelChatHistory(state.channel, historyLimit);

  // For conversational intents, instruct brevity
  const brevityHint = isConversational
    ? " Keep your response under 80 words unless the user explicitly asks for detail."
    : "";
  const systemContent = [OPTIMIZED_SYSTEM_PROMPT + brevityHint, state.contextBlock].filter(Boolean).join("\n\n");

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...history.map(m => ({ role: m.role as ChatMessage["role"], content: trimHistoryContent(m.content) })),
    { role: "user", content: state.currentInput },
  ];

  const numPredict = getNumPredict(state.intent);
  const preset = state.intent.includes("code") ? GenerationPresets.coding
    : isConversational ? GenerationPresets.conversational
    : GenerationPresets.precise;

  // num_ctx: limit context window to 2048 tokens — dramatically reduces prefill
  // time on CPU (default 8192 = 4x slower TTFT for no benefit on short chats)
  const ctxOptions = { ...preset, num_predict: numPredict, num_ctx: DEFAULT_NUM_CTX };

  let response = "";
  if (state.onToken) {
    response = await chatStream(
      {
        model: state.selectedModel,
        messages,
        options: ctxOptions,
      },
      state.onToken
    );
  } else {
    response = await chat({
      model: state.selectedModel,
      messages,
      options: ctxOptions,
    });
  }

  // Persist to memory
  addMessage("user", state.currentInput, state.channel, {
    emotion: state.mood, intent: state.intent,
  });
  addMessage("assistant", response, state.channel);

  // ── Long-term persistence (Vector RAG) ──────────────────────────────────────
  // We save the interaction if it's meaningful
  if (state.intent !== "chitchat" && state.intent !== "conversation" && response.length > 20) {
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
