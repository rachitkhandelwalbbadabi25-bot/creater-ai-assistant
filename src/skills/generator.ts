// ════════════════════════════════════════════════════════════════════════════════
// src/skills/generator.ts — Generate new skills from past conversations
// ════════════════════════════════════════════════════════════════════════════════

import { chat, type ChatMessage } from "@llm/ollama.js";
import { Models, GenerationPresets } from "@config/models.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("skills/generator");

const SKILL_PROMPT = `
You are a Skill Architect for an AI Assistant. Your job is to extract a reusable "Skill" from a conversation history.
A Skill is a sequence of tool calls that perform a specific task.

Output format MUST be JSON:
{
  "name": "Skill Name",
  "description": "What it does",
  "triggers": ["phrase 1", "phrase 2"],
  "steps": ["tool_id.function({ params })", "another_tool.function()"]
}

Available tool categories: filesystem, shell, browser, system, editor.
Example steps:
- fs.list_directory({ path: "./src" })
- shell.execute({ command: "npm test" })
- system.info()
`;

/**
 * Suggest a new skill based on a recent interaction description.
 * Returns the suggested skill definition for user approval.
 */
export async function suggestSkill(
  interactionSummary: string
): Promise<{ name: string; description: string; triggers: string[]; steps: string[] } | null> {
  log.info("Suggesting a new skill...");

  const messages: ChatMessage[] = [
    { role: "system", content: SKILL_PROMPT },
    { role: "user", content: `Based on this interaction, create a reusable skill:\n\n${interactionSummary}` },
  ];

  try {
    const response = await chat({
      model: Models.PRIMARY,
      messages,
      options: GenerationPresets.precise,
      format: "json",
    });

    const parsed = JSON.parse(response);
    if (!parsed.name || !parsed.steps?.length) {
      log.warn("Generated skill is invalid or empty");
      return null;
    }

    return parsed;
  } catch (e) {
    log.error("Failed to generate skill suggestion", e);
    return null;
  }
}
