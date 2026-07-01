// src/agents/plannerAgent.ts
import { nowMs, logPerf } from "@utils/perf.js";
import { createLogger } from "@utils/logger.js";
import type { AgentSharedContext } from "../orchestration/agentSharedContext.js";
import type { AgentResult } from "../orchestration/agentBus.js";

/**
 * Planner Agent – parses a user goal, estimates complexity, selects required agents, and
 * produces an ordered list of execution steps.
 */
export interface PlannerInput {
  userGoal: string;
}

export interface PlannerOutput {
  goal: string;
  complexity: "low" | "medium" | "high";
  requiredAgents: string[];
  steps: string[];
}

const log = createLogger("[PLANNER]");

/** Simple heuristic to estimate complexity based on token count and keyword presence */
function estimateComplexity(goal: string): "low" | "medium" | "high" {
  const wordCount = goal.split(/\s+/).length;
  const complexKeywords = ["plan", "design", "architecture", "create", "build", "analyze"];
  const hasKeyword = complexKeywords.some((kw) => goal.toLowerCase().includes(kw));
  if (wordCount > 30 || hasKeyword) return "high";
  if (wordCount > 15) return "medium";
  return "low";
}

/** Determine which agents are needed for a given complexity */
function selectAgents(complexity: "low" | "medium" | "high"): string[] {
  const base = ["memoryAgent", "reasoningAgent", "executionAgent", "verifierAgent", "responseComposer"];
  if (complexity === "low") return ["memoryAgent", "executionAgent", "responseComposer"];
  if (complexity === "medium") return ["memoryAgent", "reasoningAgent", "executionAgent", "responseComposer"];
  return base; // high complexity – include all agents
}

/** Generate a naive step list – can be refined later */
function generateSteps(goal: string, agents: string[]): string[] {
  const steps: string[] = [];
  agents.forEach((agent) => {
    steps.push(`${agent} will process the goal`);
  });
  steps.push(`final response will be composed`);
  return steps;
}

export async function plannerAgent(context: AgentSharedContext & { userGoal: string }): Promise<AgentResult<PlannerOutput>> {
  const started = nowMs();
  log.info("[LLM_CALL] none (plannerAgent)");
  const { userGoal } = context;
  const complexity = estimateComplexity(userGoal);
  const requiredAgents = selectAgents(complexity);
  const steps = generateSteps(userGoal, requiredAgents);
  const output: PlannerOutput = {
    goal: userGoal,
    complexity,
    requiredAgents,
    steps,
  };
  logPerf(log, "Planner completed", started, { complexity, agents: requiredAgents.length });
  return { result: output, metadata: { timingMs: nowMs() - started } };
}

export default plannerAgent;
