// ════════════════════════════════════════════════════════════════════════════════
// src/proactive/nightCheck.ts — Night check-in generator
// ════════════════════════════════════════════════════════════════════════════════

import { chat, type ChatMessage } from "@llm/client.js";
import { NIGHT_CHECK_PROMPT } from "@llm/prompts.js";
import { Models, GenerationPresets } from "@config/models.js";
import { DEFAULT_NUM_CTX } from "@llm/constants.js";
import { getNumPredict } from "@llm/tokenBudget.js";
import { buildUserContext } from "@utils/contextBuilder.js";
import { getTopSummaries } from "@memory/midTerm.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("proactive/nightCheck");

let deliveryCallback: ((message: string) => void) | null = null;

export function onNightCheckReady(cb: (message: string) => void): void {
  deliveryCallback = cb;
}

export async function generateNightCheck(): Promise<string> {
  const user = buildUserContext();
  const summaries = getTopSummaries(3);

  const context = [
    `Time: ${user.currentTime}`,
    `User: ${user.userName}`,
    summaries.length ? `Today's activity:\n${summaries.map(s => `- ${s.content}`).join("\n")}` : "No recorded activity today.",
  ].join("\n\n");

  const messages: ChatMessage[] = [
    { role: "system", content: NIGHT_CHECK_PROMPT },
    { role: "user", content: `Context:\n${context}\n\nGenerate the night check-in.` },
  ];

  const checkIn = await chat({
    model: Models.FAST,
    messages,
    options: { ...GenerationPresets.conversational, num_ctx: DEFAULT_NUM_CTX, num_predict: getNumPredict("night_check") },
  });

  log.info("Night check-in generated");
  if (deliveryCallback) deliveryCallback(checkIn);
  return checkIn;
}
