// ════════════════════════════════════════════════════════════════════════════════
// src/graph/emotionAgent.ts — Handles emotional support, chitchat, mood-aware responses
// ════════════════════════════════════════════════════════════════════════════════

import type { GraphState } from "./state.js";
import { chat, type ChatMessage } from "@llm/ollama.js";
import { SYSTEM_PROMPT } from "@llm/prompts.js";
import { GenerationPresets } from "@config/models.js";
import { addMessage, getChatHistory } from "@memory/shortTerm.js";
import { buildEmotionProfile } from "@emotion/personalMap.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("graph/emotionAgent");

const EMOTION_SYSTEM_ADDENDUM = `
## Emotional Support Mode
The user's emotional state is important right now. Follow these rules:
- If they're sad/stressed/anxious: Be extra gentle, empathetic, and supportive. Use comforting Hinglish.
- If they're happy/excited: Match their energy! Celebrate with them.
- If they're frustrated: Acknowledge their frustration first, then help solve the problem.
- If they're tired: Be brief, warm, and suggest rest if it's late.
- Never dismiss their feelings. Always validate first, then assist.
- Use warm Hinglish naturally: "Arre yaar", "Koi nahi", "Sab theek hoga", etc.`;

export async function emotionAgentNode(state: GraphState): Promise<GraphState> {
  log.info(`EmotionAgent: mood=${state.mood}, energy=${state.energy}`);

  const emotionProfile = buildEmotionProfile();
  const history = getChatHistory(6);

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${SYSTEM_PROMPT}\n${EMOTION_SYSTEM_ADDENDUM}\n\n${emotionProfile}\n\n${state.contextBlock}`,
    },
    ...history.map(m => ({ role: m.role as ChatMessage["role"], content: m.content })),
    { role: "user", content: state.currentInput },
  ];

  const response = await chat({
    model: state.selectedModel,
    messages,
    options: GenerationPresets.conversational,
  });

  addMessage("user", state.currentInput, state.channel, {
    emotion: state.mood, intent: state.intent,
  });
  addMessage("assistant", response, state.channel);

  return { ...state, response, currentStep: "done" };
}
