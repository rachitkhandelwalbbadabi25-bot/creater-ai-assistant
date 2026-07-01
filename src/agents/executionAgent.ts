// src/agents/executionAgent.ts

import { nowMs, logPerf } from "@utils/perf.js";
import { createLogger } from "@utils/logger.js";
import type { AgentSharedContext } from "../orchestration/agentSharedContext.js";
import type { AgentResult } from "../orchestration/agentBus.js";

export interface ExecutionOutput {
  success: boolean;
  stepsExecuted: string[];
  outputs: any[];
}

const log = createLogger("[EXECUTION]");

export async function executionAgent(
  context: AgentSharedContext
): Promise<AgentResult<ExecutionOutput>> {
  const started = nowMs();
  log.info("[LLM_CALL] none (executionAgent)");
  const planner = (context as any).plannerAgentOutput as any;
  // No LLM call — simulate execution of planner steps only
  const steps: string[] = planner?.steps ?? [];

  const outputs: any[] = [];
  const stepsExecuted: string[] = [];

  for (const step of steps) {
    stepsExecuted.push(step);
    // Simulate execution of each step; replace with real actions as needed
    outputs.push({ step, status: "simulated_success" });
  }

  const output: ExecutionOutput = {
    success: true,
    stepsExecuted,
    outputs,
  };

  logPerf(log, "Execution completed", started, { stepsCount: steps.length });
  return { result: output, metadata: { timingMs: nowMs() - started } };
}

export default executionAgent;
