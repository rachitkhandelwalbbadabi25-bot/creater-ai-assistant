// ════════════════════════════════════════════════════════════════════════════════
// src/graph/conversationAgent.ts — Dedicated conversational agent
// ════════════════════════════════════════════════════════════════════════════════

import type { GraphState } from "./state.js";
import { chat, chatStream, type ChatMessage } from "@llm/client.js";
import { OPTIMIZED_SYSTEM_PROMPT } from "@llm/prompts.js";
import { GenerationPresets } from "@config/models.js";
import { DEFAULT_NUM_CTX } from "@llm/constants.js";
import { getNumPredict } from "@llm/tokenBudget.js";
import { addMessage, getChannelChatHistory } from "@memory/shortTerm.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("graph/conversationAgent");

function trimHistoryContent(content: string): string {
  return content.length > 500 ? `${content.slice(0, 500)}...` : content;
}

export async function conversationAgentNode(state: GraphState): Promise<GraphState> {
  log.info("[CONVERSATION_AGENT_START]", { input: state.currentInput, channel: state.channel });

  const history = getChannelChatHistory(state.channel, 4);

  const conversationalPrompt =
    OPTIMIZED_SYSTEM_PROMPT +
    "\n\nYou are having a friendly, natural conversation with the user. Respond concisely (under 60 words unless asked for more), in the same language or tone (Hindi, Hinglish, or English) the user spoke in. Maintain your true identity as Creater AI created by Rachit Khandelwal.";

  const systemContent = [conversationalPrompt, state.contextBlock].filter(Boolean).join("\n\n");

  const messages: ChatMessage[] = [
    { role: "system", content: systemContent },
    ...history.map((m) => ({ role: m.role as ChatMessage["role"], content: trimHistoryContent(m.content) })),
    { role: "user", content: state.currentInput },
  ];

  const numPredict = getNumPredict("conversation");
  const ctxOptions = {
    ...GenerationPresets.conversational,
    num_predict: numPredict,
    num_ctx: DEFAULT_NUM_CTX,
  };

  let response = "";
  try {
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
  } catch (error: any) {
    log.error("[CONVERSATION_AGENT_ERROR]", error);
    throw error;
  }

  // Persist normal conversational turns in short-term memory
  addMessage("user", state.currentInput, state.channel, {
    emotion: state.mood,
    intent: "conversation",
  });
  addMessage("assistant", response, state.channel);

  // Normal conversation completes cleanly — NEVER hand off to executionAgent
  state.targetAgent = "";
  log.info("[CONVERSATION_AGENT_RETURN]");
  return { ...state, response, currentStep: "done" };
}
