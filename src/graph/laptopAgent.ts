// ════════════════════════════════════════════════════════════════════════════════
// src/graph/laptopAgent.ts — Handles system control, shell, browser, file operations
// ════════════════════════════════════════════════════════════════════════════════

import type { GraphState } from "./state.js";
import { chat, type ChatMessage } from "@llm/ollama.js";
import { SYSTEM_PROMPT, buildToolSelectionPrompt } from "@llm/prompts.js";
import { GenerationPresets } from "@config/models.js";
import { TOOL_REGISTRY, requiresConfirmation } from "@config/tools.js";
import { env } from "@config/index.js";
import { addMessage } from "@memory/shortTerm.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("graph/laptopAgent");

export async function laptopAgentNode(state: GraphState): Promise<GraphState> {
  log.info(`LaptopAgent: intent=${state.intent}`);

  // Get relevant tools for this intent
  const toolNames = TOOL_REGISTRY
    .filter(t => {
      if (state.intent === "system_control") return t.category === "system" || t.category === "shell";
      if (state.intent === "browser_action") return t.category === "browser";
      if (state.intent === "file_operation") return t.category === "filesystem";
      return true;
    })
    .map(t => `${t.id}: ${t.description}`);

  // Ask LLM to select tools and generate response
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${SYSTEM_PROMPT}\n\n${buildToolSelectionPrompt(toolNames)}\n\n${state.contextBlock}`,
    },
    { role: "user", content: state.currentInput },
  ];

  const response = await chat({
    model: state.selectedModel,
    messages,
    options: GenerationPresets.precise,
  });

  // Check if tool execution requires confirmation
  let needsConfirmation = false;
  try {
    const parsed = JSON.parse(response);
    if (parsed.tools?.length > 0) {
      for (const toolCall of parsed.tools) {
        const toolDef = TOOL_REGISTRY.find(t => t.id === toolCall.id);
        if (toolDef && requiresConfirmation(toolDef, env.SAFETY_MODE as "strict" | "moderate" | "permissive")) {
          needsConfirmation = true;
          return {
            ...state,
            requiresConfirmation: true,
            pendingConfirmation: {
              toolId: toolCall.id,
              params: toolCall.params,
              reason: `Tool "${toolDef.name}" requires your confirmation (${toolDef.permission} permission).`,
            },
            response: `🔒 ${toolDef.name} ke liye permission chahiye. Kya run karun?\n> \`${toolCall.id}\` with params: ${JSON.stringify(toolCall.params)}`,
            currentStep: "responding",
          };
        }
      }
    }
  } catch {
    // Response wasn't JSON — it's a direct text response, that's fine
  }

  addMessage("user", state.currentInput, state.channel, { intent: state.intent });
  addMessage("assistant", response, state.channel);

  return { ...state, response, currentStep: "done" };
}
