// ════════════════════════════════════════════════════════════════════════════════
// src/skills/generator.ts — Auto-create new skills from repeated patterns
// ════════════════════════════════════════════════════════════════════════════════

import { chat, type ChatMessage } from "@llm/ollama.js";
import { SKILL_GENERATION_PROMPT } from "@llm/prompts.js";
import { Models, GenerationPresets } from "@config/models.js";
import { registerSkill } from "./manager.js";
import { env } from "@config/index.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("skills/generator");

/**
 * Generate a new skill from a description of a repeated user pattern.
 * Uses the primary LLM to create a structured skill definition.
 */
export async function generateSkill(
  patternDescription: string
): Promise<{ name: string; description: string } | null> {
  if (!env.AUTO_GENERATE_SKILLS) {
    log.info("Auto skill generation is disabled");
    return null;
  }

  log.info(`Generating skill from pattern: "${patternDescription.slice(0, 80)}"`);

  const messages: ChatMessage[] = [
    { role: "system", content: SKILL_GENERATION_PROMPT },
    { role: "user", content: `Pattern observed:\n${patternDescription}\n\nGenerate a reusable skill.` },
  ];

  try {
    const response = await chat({
      model: Models.PRIMARY,
      messages,
      options: GenerationPresets.precise,
      format: "json",
    });

    const parsed = JSON.parse(response) as {
      name: string;
      description: string;
      trigger_patterns: string[];
      steps: unknown[];
    };

    if (!parsed.name || !parsed.trigger_patterns?.length) {
      log.warn("LLM returned invalid skill definition");
      return null;
    }

    registerSkill(parsed.name, parsed.description, parsed.trigger_patterns, parsed.steps);
    log.info(`Skill auto-generated: ${parsed.name}`);

    return { name: parsed.name, description: parsed.description };
  } catch (e) {
    log.error("Skill generation failed", e);
    return null;
  }
}
