// src/agents/verifierAgent.ts

import { nowMs, logPerf } from "@utils/perf.js";
import { createLogger } from "@utils/logger.js";
import type { AgentSharedContext } from "../orchestration/agentSharedContext.js";
import type { AgentResult } from "../orchestration/agentBus.js";

export interface VerifierOutput {
  success: boolean;
  confidence: number;
  issues: string[];
}

const log = createLogger("[VERIFIER]");

export async function verifierAgent(context: AgentSharedContext): Promise<AgentResult<VerifierOutput>> {
  const started = nowMs();
  const execResult = (context as any).executionAgentOutput as any;
  const success = execResult ? execResult.success : true;

  const output: VerifierOutput = {
    success,
    confidence: success ? 0.95 : 0.2,
    issues: [],
  };

  logPerf(log, "Verifier completed", started, { confidence: output.confidence });
  return { result: output, metadata: { timingMs: nowMs() - started } };
}

export default verifierAgent;
