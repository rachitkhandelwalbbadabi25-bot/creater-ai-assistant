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

/** Parse user goal into concrete action-phrase steps the executionAgent keyword-router can match */
function generateSteps(goal: string, _agents: string[]): string[] {
  const g = goal.toLowerCase();

  // ── Browser research / search workflow ──────────────────────────────────────
  const isBrowserSearch =
    (g.includes("open") && (g.includes("google") || g.includes("browser"))) ||
    g.includes("search") ||
    g.includes("look up") ||
    g.includes("find on") ||
    g.includes("research");

  if (isBrowserSearch) {
    // Extract the search query from the goal
    let query = "";

    // Patterns: "search AI agents", "search for AI agents", "look up AI agents"
    const searchMatch =
      goal.match(/search\s+(?:for\s+)?["']?([^"'.]+)["']?/i) ||
      goal.match(/look\s+up\s+["']?([^"'.]+)["']?/i) ||
      goal.match(/research\s+["']?([^"'.]+)["']?/i);
    if (searchMatch) {
      query = searchMatch[1].replace(/\s+and\s+.*/i, "").trim();
    }

    // Detect target provider
    let url = "https://www.google.com";
    if (g.includes("youtube")) url = "https://www.youtube.com";
    else if (g.includes("github")) url = "https://www.github.com";

    const steps: string[] = [
      "open browser",
      `navigate to ${url}`,
    ];
    if (query) {
      steps.push(`search for "${query}"`);
    }
    steps.push("extract text and summarize findings");
    return steps;
  }

  // ── Generic fallback: one step per word-group ────────────────────────────────
  return [
    `process goal: ${goal}`,
    "final response will be composed",
  ];
}

export async function plannerAgent(context: AgentSharedContext & { userGoal: string }): Promise<AgentResult<PlannerOutput>> {
  log.info('[PLANNER_AGENT_START]');
  const started = nowMs();
  log.info('[LLM_CALL] none (plannerAgent)');
  const { userGoal } = context;
  const complexity = estimateComplexity(userGoal);
  log.info('[PLANNER_AGENT_AFTER_COMPLEXITY]', { complexity });
  const requiredAgents = selectAgents(complexity);
  const steps = generateSteps(userGoal, requiredAgents);
  log.info('[PLANNER_AGENT_AFTER_STEPS]', { stepsCount: steps.length });
  const output: PlannerOutput = {
    goal: userGoal,
    complexity,
    requiredAgents,
    steps,
  };
  logPerf(log, "Planner completed", started, { complexity, agents: requiredAgents.length });
  log.info('[PLANNER_AGENT_RETURN]');
  return { result: output, metadata: { timingMs: nowMs() - started } };
}


export default plannerAgent;
