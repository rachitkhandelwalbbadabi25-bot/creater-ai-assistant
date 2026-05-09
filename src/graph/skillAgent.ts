// ════════════════════════════════════════════════════════════════════════════════
// src/graph/skillAgent.ts — Orchestrates the execution of pre-defined skills
// ════════════════════════════════════════════════════════════════════════════════

import type { GraphState } from "./state.js";
import { findMatchingSkill, type Skill } from "@skills/manager.js";
import { dispatchTool } from "@tools/dispatcher.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("graph/skillAgent");

/**
 * Skill Agent Node — Executes a sequence of predefined steps.
 * This is safer because the steps are already defined in the skill file.
 */
export async function skillAgentNode(state: GraphState): Promise<GraphState> {
  log.info("Executing Skill Agent Node...");

  // 1. Find matching skill if not already set
  const skill = findMatchingSkill(state.currentInput);
  if (!skill) {
    log.warn("No matching skill found for input");
    return { ...state, currentStep: "responding", response: "I found a trigger for a skill, but the skill file is missing or invalid." };
  }

  log.info(`Running skill: ${skill.name}`);

  const results: string[] = [];
  
  // 2. Execute steps sequentially
  for (const step of skill.steps) {
    try {
      log.tool(`Skill Step: ${step}`);
      // Parse step: "category.tool({ args })"
      const result = await executeSkillStep(step);
      results.push(`Step [${step}]: ${JSON.stringify(result).slice(0, 100)}`);
    } catch (e) {
      log.error(`Skill step failed: ${step}`, e);
      results.push(`Step [${step}] FAILED: ${String(e)}`);
      break; // Stop on failure
    }
  }

  return {
    ...state,
    response: `Executed skill "${skill.name}".\nResults:\n${results.join("\n")}`,
    currentStep: "responding",
  };
}

/**
 * Helper to parse and execute a single skill step string.
 * Format: "category.tool({ "arg": "value" })"
 */
async function executeSkillStep(stepStr: string): Promise<any> {
  const match = stepStr.match(/^(\w+)\.(\w+)\((.*)\)$/);
  if (!match) throw new Error(`Invalid skill step format: ${stepStr}`);

  const [, category, toolId, argsRaw] = match;
  let args = {};
  
  if (argsRaw && argsRaw.trim()) {
    try {
      args = JSON.parse(argsRaw!);
    } catch (e) {
      log.warn(`Failed to parse args for step: ${stepStr}. Attempting manual extraction.`);
      // Fallback: very simple extraction for non-standard JSON
      // This is a placeholder for a better parser if needed
    }
  }

  // Use the central dispatcher for safety and consistency
  return await dispatchTool(`${category}.${toolId}`, args);
}
