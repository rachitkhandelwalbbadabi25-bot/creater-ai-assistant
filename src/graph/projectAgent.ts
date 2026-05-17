// ════════════════════════════════════════════════════════════════════════════════
// src/graph/projectAgent.ts — Handles project analysis, code tasks, git operations
// ════════════════════════════════════════════════════════════════════════════════

import type { GraphState } from "./state.js";
import { chat, type ChatMessage } from "@llm/client.js";
import { SYSTEM_PROMPT } from "@llm/prompts.js";
import { GenerationPresets, Models } from "@config/models.js";
import { addMessage, getChatHistory } from "@memory/shortTerm.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("graph/projectAgent");

const PROJECT_ADDENDUM = `
## Code & Project Mode
You are now in code/project mode. Follow these rules:
- Be precise and technical. No unnecessary filler.
- When writing code, use proper formatting with language tags.
- If asked to review code, be constructive but honest about issues.
- For debugging, think step by step — identify root cause before suggesting fixes.
- Always consider edge cases and error handling.
- If a git operation is needed, explain what will happen before doing it.`;

export async function projectAgentNode(state: GraphState): Promise<GraphState> {
  log.info(`ProjectAgent: intent=${state.intent}`);

  const isCodeTask = state.intent.includes("code");
  const model = isCodeTask ? Models.CODER : state.selectedModel;
  const preset = isCodeTask ? GenerationPresets.coding : GenerationPresets.precise;
  const history = getChatHistory(6);

  const messages: ChatMessage[] = [
    { role: "system", content: `${SYSTEM_PROMPT}\n${PROJECT_ADDENDUM}\n\n${state.contextBlock}` },
    ...history.map(m => ({ role: m.role as ChatMessage["role"], content: m.content })),
    { role: "user", content: state.currentInput },
  ];

  const response = await chat({ model, messages, options: preset });

  addMessage("user", state.currentInput, state.channel, { intent: state.intent });
  addMessage("assistant", response, state.channel);

  return { ...state, response, currentStep: "done" };
}
