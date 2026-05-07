// ════════════════════════════════════════════════════════════════════════════════
// src/graph/skillAgent.ts — Handles skill discovery, execution, and generation
// ════════════════════════════════════════════════════════════════════════════════

import type { GraphState } from "./state.js";
import { chat, type ChatMessage } from "@llm/ollama.js";
import { SYSTEM_PROMPT, SKILL_GENERATION_PROMPT } from "@llm/prompts.js";
import { GenerationPresets } from "@config/models.js";
import { addMessage } from "@memory/shortTerm.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("graph/skillAgent");

export async function skillAgentNode(state: GraphState): Promise<GraphState> {
  log.info(`SkillAgent handling request`);

  const messages: ChatMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n\n${state.contextBlock}` },
    { role: "user", content: state.currentInput },
  ];

  const response = await chat({
    model: state.selectedModel,
    messages,
    options: GenerationPresets.precise,
  });

  addMessage("user", state.currentInput, state.channel, { intent: state.intent });
  addMessage("assistant", response, state.channel);

  return { ...state, response, currentStep: "done" };
}
