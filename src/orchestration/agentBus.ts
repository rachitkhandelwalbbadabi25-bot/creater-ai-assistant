// src/orchestration/agentBus.ts

import { createLogger } from "@utils/logger.js";
import { nowMs, logPerf } from "@utils/perf.js";
import { detectComplexity } from "./complexityDetector.js";
import { agentRegistry } from "./agentRegistry.js";
import type { AgentSharedContext } from "./agentSharedContext.js";
import { initWorkflow, setWorkflowStatus, appendStepResult } from "../orchestrator/status.js";

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

/** Run the full multi‑agent pipeline integrated with internalOrchestrator tracking */
export async function runAgentBus(message: AgentMessage): Promise<string> {
  console.log("[MODULE_INSTANCE]", { file: "agentBus.ts", event: "start", id: MODULE_INSTANCE_ID, requestId: message.requestId });
  const taskId = message.requestId || `task_${Date.now()}`;
  const correlationId = crypto.randomUUID();
  initWorkflow(taskId, correlationId);
  setWorkflowStatus(taskId, "running");

  try {
    const start = nowMs();
    // Determine complexity & mode deterministically
    const { mode, complexity } = detectComplexity(message.userGoal);
    const executionMode: "legacy" | "multi-agent" = mode;

    // Build shared context
    const context: AgentSharedContext = {
      requestId: taskId,
      executionMode,
    };

    // Step 1: Planner Agent
    const planner = agentRegistry["plannerAgent"].agentFn as any;
    const plannerResult = await planner({ ...context, userGoal: message.userGoal });
    const plannerOutput = (plannerResult as any).result;
    (context as any).plannerAgentOutput = plannerOutput;
    appendStepResult(taskId, { stepId: "plannerAgent", status: "completed", output: plannerOutput });

    // Select agents list (mirroring planner's selection)
    const requiredAgents = (plannerOutput.requiredAgents as string[]) || [];
    const executionPlan: AgentExecutionPlan = { agents: requiredAgents };

    // Sequential execution of each agent tracked in internalOrchestrator
    for (const agentName of executionPlan.agents) {
      if (agentName === "responseComposer" || agentName === "plannerAgent") continue;
      const agentEntry = agentRegistry[agentName];
      if (!agentEntry) continue;
      
      const fn = agentEntry.agentFn as any;
      try {
        const res = await fn(context);
        const agentOutput = (res as any).result;
        (context as any)[`${agentName}Output`] = agentOutput;
        appendStepResult(taskId, { stepId: agentName, status: "completed", output: agentOutput });
      } catch (err) {
        appendStepResult(taskId, { stepId: agentName, status: "failed", error: String(err) });
        throw err;
      }
    }

    // Finally compose response
    const composerFn = agentRegistry["responseComposer"].agentFn as any;
    const finalRes = await composerFn(context);
    const finalResponse = (finalRes as any).result;
    appendStepResult(taskId, { stepId: "responseComposer", status: "completed", output: finalResponse });

    setWorkflowStatus(taskId, "completed");
    logPerf(log, "Agent bus completed via internal orchestrator", start, { totalMs: nowMs() - start });
    return finalResponse;
  } catch (error) {
    setWorkflowStatus(taskId, "failed");
    throw error;
  } finally {
    console.log("[MODULE_INSTANCE]", { file: "agentBus.ts", event: "end", id: MODULE_INSTANCE_ID, requestId: message.requestId });
  }
}

export default runAgentBus;


