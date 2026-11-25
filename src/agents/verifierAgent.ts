// src/agents/verifierAgent.ts

import { nowMs, logPerf } from "@utils/perf.js";
import { createLogger } from "@utils/logger.js";
import type { AgentSharedContext } from "../orchestration/agentSharedContext.js";
import type { AgentResult } from "../orchestration/agentBus.js";

export interface VerifierOutput {
  success: boolean;
  verified: boolean;
  confidence: number;
  issues: string[];
}

const log = createLogger("[VERIFIER]");

export async function verifierAgent(context: AgentSharedContext): Promise<AgentResult<VerifierOutput>> {
  const started = nowMs();
  const execResult = (
    context as {
      executionAgentOutput?: {
        success?: boolean;
        universalPlan?: import("../orchestration/universalPlan.js").UniversalExecutionPlan;
        outputs?: Array<{ status?: string; verified?: boolean; error?: string; step?: string }>;
      };
    }
  ).executionAgentOutput;

  if (execResult?.universalPlan) {
    const actions = execResult.universalPlan.actions;
    const issues = actions
      .filter((a) => a.status !== "completed" || !a.evidence?.verified)
      .map((a) => `${a.type} (${a.status}): ${a.evidence?.reason || a.error || "not verified"}`);
    const allCompleted = actions.length > 0 && actions.every((a) => a.status === "completed");
    const allVerified = allCompleted && actions.every((a) => a.evidence?.verified === true);
    const output: VerifierOutput = {
      success: allCompleted,
      verified: allVerified,
      confidence: allVerified ? 0.98 : allCompleted ? 0.7 : 0.25,
      issues,
    };
    logPerf(log, "Verifier completed (universalPlan)", started, {
      confidence: output.confidence,
      verified: allVerified,
      issuesCount: issues.length,
    });
    return { result: output, metadata: { timingMs: nowMs() - started } };
  }

  const outputs = execResult?.outputs ?? [];
  const issues: string[] = [];

  for (const out of outputs) {
    if (out.status === "error") {
      issues.push(out.error || `Step "${out.step || "unknown"}" failed.`);
    } else if (out.status === "unverified") {
      issues.push(`Step "${out.step || "unknown"}" could not be verified.`);
    }
  }

  const hasOutputs = outputs.length > 0;
  const success = execResult ? Boolean(execResult.success) && !outputs.some((o) => o.status === "error") : true;
  const verified = hasOutputs ? issues.length === 0 && outputs.every((o) => o.verified !== false) : success;

  const output: VerifierOutput = {
    success,
    verified,
    confidence: success ? (verified ? 0.95 : 0.75) : 0.2,
    issues,
  };

  logPerf(log, "Verifier completed", started, { confidence: output.confidence, verified, issuesCount: issues.length });
  return { result: output, metadata: { timingMs: nowMs() - started } };
}

export default verifierAgent;
