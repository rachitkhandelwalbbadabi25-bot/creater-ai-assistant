// ════════════════════════════════════════════════════════════════════════════════
// src/graph/emotionAgent.ts — Handles emotional support, chitchat, mood-aware responses
// ════════════════════════════════════════════════════════════════════════════════

import type { GraphState } from "./state.js";
import { chat, chatStream, type ChatMessage } from "@llm/client.js";
import { OPTIMIZED_SYSTEM_PROMPT } from "@llm/prompts.js";
import { GenerationPresets } from "@config/models.js";
import { DEFAULT_NUM_CTX } from "@llm/constants.js";
import { getNumPredict } from "@llm/tokenBudget.js";
import { addMessage, getChatHistory } from "@memory/shortTerm.js";
import { buildEmotionProfile } from "@emotion/personalMap.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("graph/emotionAgent");

const EMOTION_SYSTEM_ADDENDUM =
  "Emotional support mode: validate the user's feeling first, match their language and intensity, then respond briefly and warmly. For happy/excited messages, celebrate. For sad/stressed/anxious messages, be gentle and supportive. Do not mention hidden context. Keep your response under 80 words unless the user is in deep distress.";

function trimHistoryContent(content: string): string {
  return content.length > 300 ? `${content.slice(0, 300)}...` : content;
}

function getHistoryLimit(tier: GraphState["emotionContextTier"]): number {
  if (tier === "analysis") return 4;
  if (tier === "deep") return 2;
  return 0;
}

function buildMinimalEmotionContext(state: GraphState): string {
  const parts = [`Current mood: ${state.mood}`];
  if (state.energy) parts.push(`energy: ${state.energy}`);
  if (state.emotionConfidence > 0) parts.push(`confidence: ${(state.emotionConfidence * 100).toFixed(0)}%`);
  return parts.join(" | ");
}

export function buildEmotionMessages(state: GraphState): ChatMessage[] {
  const tier = state.emotionContextTier ?? "simple";
  const emotionProfile = tier === "analysis" ? buildEmotionProfile() : "";
  const history = getChatHistory(getHistoryLimit(tier));
  const contextParts = [
    OPTIMIZED_SYSTEM_PROMPT,
    EMOTION_SYSTEM_ADDENDUM,
    buildMinimalEmotionContext(state),
    tier !== "simple" ? state.contextBlock : "",
    emotionProfile,
  ].filter(Boolean);

  return [
    {
      role: "system",
      content: contextParts.join("\n\n"),
    },
    ...history.map(m => ({ role: m.role as ChatMessage["role"], content: trimHistoryContent(m.content) })),
    { role: "user", content: state.currentInput },
  ];
}

export async function emotionAgentNode(state: GraphState): Promise<GraphState> {
  log.info(`EmotionAgent: mood=${state.mood}, energy=${state.energy}`);

  const messages = buildEmotionMessages(state);

  let response = "";
  if (state.onToken) {
    response = await chatStream(
      {
        model: state.selectedModel,
        messages,
        options: { ...GenerationPresets.conversational, num_ctx: DEFAULT_NUM_CTX, num_predict: getNumPredict(state.intent) },
      },
      state.onToken
    );
  } else {
    response = await chat({
      model: state.selectedModel,
      messages,
      options: { ...GenerationPresets.conversational, num_ctx: DEFAULT_NUM_CTX, num_predict: getNumPredict(state.intent) },
    });
  }

  addMessage("user", state.currentInput, state.channel, {
    emotion: state.mood, intent: state.intent,
  });
  addMessage("assistant", response, state.channel);

  return { ...state, response, currentStep: "done" };
}
