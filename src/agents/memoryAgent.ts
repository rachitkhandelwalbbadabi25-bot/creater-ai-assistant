// src/agents/memoryAgent.ts

import { nowMs, logPerf } from "@utils/perf.js";
import { createLogger } from "@utils/logger.js";
import type { AgentSharedContext } from "../orchestration/agentSharedContext.js";
import type { AgentResult } from "../orchestration/agentBus.js";

/**
 * Memory Agent – aggregates data from the existing Living Memory system.
 * For this implementation we stub the calls and return empty structures.
 */
export interface MemoryOutput {
  memories: any[];
  insights: any[];
  timelineEvents: any[];
  projects: any[];
  personality: Record<string, unknown>;
}

const log = createLogger("[MEMORY]");

export async function memoryAgent(context: AgentSharedContext): Promise<AgentResult<MemoryOutput>> {
  const started = nowMs();                        // ← Phase 6 fix: define before any logPerf usage
  log.info("[LLM_CALL] none (memoryAgent)");
  // TODO: integrate real memory modules (timeline, graph, etc.)
  const output: MemoryOutput = {
    memories: [],
    insights: [],
    timelineEvents: [],
    projects: [],
    personality: {},
  };
  logPerf(log, "Memory aggregation completed", started, {});
  return { result: output, metadata: { timingMs: nowMs() - started } };
}

export default memoryAgent;
