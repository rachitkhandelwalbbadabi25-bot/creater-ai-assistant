// ════════════════════════════════════════════════════════════════════════════════
// src/proactive/briefing.ts — Morning briefing generator
// ════════════════════════════════════════════════════════════════════════════════

import { chat, type ChatMessage } from "@llm/ollama.js";
import { MORNING_BRIEFING_PROMPT } from "@llm/prompts.js";
import { Models, GenerationPresets } from "@config/models.js";
import { buildUserContext } from "@utils/contextBuilder.js";
import { getTopSummaries } from "@memory/midTerm.js";
import { buildEmotionProfile } from "@emotion/personalMap.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("proactive/briefing");

// Callback for delivering the briefing (set by TUI/Telegram/etc.)
let deliveryCallback: ((message: string) => void) | null = null;

export function onBriefingReady(cb: (message: string) => void): void {
  deliveryCallback = cb;
}

export async function generateMorningBriefing(): Promise<string> {
  const user = buildUserContext();
  const summaries = getTopSummaries(5);
  const emotionProfile = buildEmotionProfile();

  const context = [
    `Current: ${user.currentTime} (${user.dayOfWeek})`,
    `User: ${user.userName}`,
    emotionProfile,
    summaries.length ? `Recent summaries:\n${summaries.map(s => `- ${s.content}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");

  const messages: ChatMessage[] = [
    { role: "system", content: MORNING_BRIEFING_PROMPT },
    { role: "user", content: `Context:\n${context}\n\nGenerate the morning briefing.` },
  ];

  const briefing = await chat({
    model: Models.PRIMARY,
    messages,
    options: GenerationPresets.conversational,
  });

  log.info("Morning briefing generated");

  if (deliveryCallback) deliveryCallback(briefing);
  return briefing;
}
