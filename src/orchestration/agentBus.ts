// src/orchestration/agentBus.ts

import { createLogger } from "@utils/logger.js";
import { nowMs, logPerf } from "@utils/perf.js";
import { detectComplexity } from "./complexityDetector.js";
import { agentRegistry } from "./agentRegistry.js";
import type { AgentSharedContext } from "./agentSharedContext.js";

/** Basic message passed to the first agent (Planner) */
export interface AgentMessage {
  userGoal: string; // original user input
  requestId: string;
}

/** Generic result wrapper for agents */
export interface AgentResult<T = any> {
  result: T;
  metadata?: { timingMs?: number };
}

/** Execution context shared across agents */
export type AgentContext = AgentSharedContext;

/** Simple execution plan (list of agent names in order) */
export interface AgentExecutionPlan {
  agents: string[]; // e.g., ["plannerAgent","memoryAgent",...]
}

const log = createLogger("[AGENT_BUS]");

const MODULE_INSTANCE_ID = Math.random().toString(36).slice(2);
console.log("[MODULE_INSTANCE]", { file: "agentBus.ts", event: "load", id: MODULE_INSTANCE_ID });

/** Run the full multi‑agent pipeline */
export async function runAgentBus(message: AgentMessage): Promise<string> {
  console.log("[MODULE_INSTANCE]", { file: "agentBus.ts", event: "start", id: MODULE_INSTANCE_ID, requestId: message.requestId });
  try {
    const start = nowMs();
    // Determine complexity & mode deterministically
    const { mode, complexity } = detectComplexity(message.userGoal);
    const executionMode: "legacy" | "multi-agent" = mode;

    // Build shared context
    const context: AgentSharedContext = {
      requestId: message.requestId,
      executionMode,
      // other fields will be filled by agents
    };

    // Choose agents based on complexity (reuse planner logic)
    const planner = agentRegistry["plannerAgent"].agentFn as any;
    const plannerResult = await planner({ ...context, userGoal: message.userGoal });
    const plannerOutput = (plannerResult as any).result;
    // Store for later agents
    (context as any).plannerAgentOutput = plannerOutput;

    // Select agents list (mirroring planner's selection)
    const requiredAgents = plannerOutput.requiredAgents as string[];
    const executionPlan: AgentExecutionPlan = { agents: requiredAgents };

    // Sequential execution of each agent
    for (const agentName of executionPlan.agents) {
      if (agentName === "responseComposer") continue;
      const agentEntry = agentRegistry[agentName];
      if (!agentEntry) continue;
      const fn = agentEntry.agentFn as any;
      const res = await fn(context);
      // Attach each result to context for later use
      (context as any)[`${agentName}Output`] = (res as any).result;
    }

    // Finally compose response
    const composerFn = agentRegistry["responseComposer"].agentFn as any;
    const finalRes = await composerFn(context);
    const finalResponse = (finalRes as any).result;

    logPerf(log, "Agent bus completed", start, { totalMs: nowMs() - start });
    return finalResponse;
  } finally {
    console.log("[MODULE_INSTANCE]", { file: "agentBus.ts", event: "end", id: MODULE_INSTANCE_ID, requestId: message.requestId });
  }
}

export default runAgentBus;
