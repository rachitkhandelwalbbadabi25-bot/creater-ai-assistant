// src/agents/reasoningAgent.ts

import { nowMs, logPerf } from "@utils/perf.js";
import { createLogger } from "@utils/logger.js";
import type { AgentSharedContext } from "../orchestration/agentSharedContext.js";
import type { AgentResult } from "../orchestration/agentBus.js";

export interface ReasoningOutput {
  reasoning: string;
  alternatives: string[];
  recommendation: string;
}

const log = createLogger("[REASONING]");

/** Simple stub reasoning - in real implementation would call LLM */
export async function reasoningAgent(context: AgentSharedContext): Promise<AgentResult<ReasoningOutput>> {
  const started = nowMs();
  // Access planner and memory results if they exist on the context
  const planner = (context as any).plannerAgentOutput as { goal: string } | undefined;
  const memory = (context as any).memoryAgentOutput as { insights: any[] } | undefined;

  const reasoning = planner?.goal
    ? `Analyzed goal "${planner.goal}" with ${memory?.insights?.length ?? 0} insights.`
    : "No goal provided.";
  const alternatives = ["Alternative A", "Alternative B"];
  const recommendation = "Proceed with the primary plan.";

  const output: ReasoningOutput = { reasoning, alternatives, recommendation };
  logPerf(log, "Reasoning completed", started, {});
  return { result: output, metadata: { timingMs: nowMs() - started } };
}

export default reasoningAgent;
