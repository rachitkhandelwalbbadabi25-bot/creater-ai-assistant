// src/agents/responseComposer.ts

import { nowMs, logPerf } from "@utils/perf.js";
import { createLogger } from "@utils/logger.js";
import type { AgentSharedContext } from "../orchestration/agentSharedContext.js";
import type { AgentResult } from "../orchestration/agentBus.js";
import { chatStream } from "../llm/ollama.js";
import { env } from "@config/index.js";

const log = createLogger("[COMPOSER]");

const MODULE_INSTANCE_ID = Math.random().toString(36).slice(2);
console.log("[MODULE_INSTANCE]", { file: "responseComposer.ts", event: "load", id: MODULE_INSTANCE_ID });

/** Helper to create compact textual summaries from agent outputs */
function summarizePlanner(planner: any): string {
  return `Planner: Complexity ${planner?.complexity ?? "unknown"}`;
}
function summarizeMemory(memory: any): string {
  return `Memory: ${memory?.insights ? "insights available" : "no insights"}`;
}
function summarizeReasoning(reasoning: any): string {
  return `Reasoning: ${reasoning?.reasoning?.slice(0, 120) ?? ""}`;
}
function summarizeExecution(execution: any): string {
  const steps = execution?.stepsExecuted?.length ?? 0;
  return `Execution: ${steps} step(s) completed`;
}
function summarizeVerifier(verifier: any): string {
  return `Verifier: confidence ${verifier?.confidence ?? "?"}`;
}

/** Estimate token count roughly as chars/4 */
function estimateTokens(chars: number): number {
  return Math.max(1, Math.floor(chars / 4));
}

export async function responseComposer(
  context: AgentSharedContext
): Promise<AgentResult<string>> {
  console.log("[MODULE_INSTANCE]", { file: "responseComposer.ts", event: "start", id: MODULE_INSTANCE_ID, requestId: context.requestId });
  try {
    const composerStart = nowMs();
    log.info("[RESPONSE_COMPOSER] started");

    const planner = (context as any).plannerAgentOutput;
    const memory = (context as any).memoryAgentOutput;
    const reasoning = (context as any).reasoningAgentOutput;
    const execution = (context as any).executionAgentOutput;
    const verifier = (context as any).verifierAgentOutput;

    // Build compact prompt
    const compactPrompt = `User goal: ${planner?.goal ?? ""}\n\n` +
      `${summarizePlanner(planner)}\n` +
      `${summarizeMemory(memory)}\n` +
      `${summarizeReasoning(reasoning)}\n` +
      `${summarizeExecution(execution)}\n` +
      `${summarizeVerifier(verifier)}\n\n` +
      `Provide a complete, user‑facing answer that fulfills the request. Do not include any of the above debug data in the answer.`;

    const composerPromptChars = compactPrompt.length;
    const composerPromptTokensEstimate = estimateTokens(composerPromptChars);
    const finalPayloadSize = Buffer.byteLength(compactPrompt, "utf8");

    log.info("[COMPOSER_METRICS]", {
      composerPromptChars,
      composerPromptTokensEstimate,
      finalPayloadSize,
    });

    // Performance timing for Ollama start
    const ollamaStart = nowMs();
    log.info("[COMPOSER_OLLAMA_START]");

    let finalAnswer = "";
    try {
      // Use chatStream for immediate token delivery — stream:true is set internally by chatStream
      finalAnswer = await chatStream(
        {
          model: env.OLLAMA_PRIMARY_MODEL || "qwen2.5:3b",
          messages: [{ role: "user", content: compactPrompt }],
          // Force generation limits — cast as any because num_ctx is not in GenerationOptions
          options: {
            num_predict: 300,
            temperature: 0.3,
            top_p: 0.9,
            repeat_penalty: 1.1,
            num_ctx: 1024,
          } as any,
        } as any,
        // Token callback to capture first token timing
        (token) => {
          if (token && token.trim().length > 0) {
            const firstTokenMs = nowMs() - ollamaStart;
            log.info("[COMPOSER_FIRST_TOKEN_MS]", { firstTokenMs });
          }
        }
      );
      const composerAnswerChars = finalAnswer.length;
      log.info("[RESPONSE_COMPOSER] generated_final_answer");
      log.info("[RESPONSE_COMPOSER] response_length=" + composerAnswerChars);
    } catch (err) {
      log.warn("ResponseComposer LLM generation failed", { error: err });
      // Fallback: simple concatenated summaries
      finalAnswer = [
        summarizePlanner(planner),
        summarizeMemory(memory),
        summarizeReasoning(reasoning),
        summarizeExecution(execution),
        summarizeVerifier(verifier),
      ]
        .filter(Boolean)
        .join("\n");
    }

    const totalMs = nowMs() - composerStart;
    log.info("[COMPOSER_TOTAL_MS]", { totalMs });
    logPerf(log, "Response Composer completed", composerStart, {
      COMPOSER_BUILD_MS: ollamaStart - composerStart,
      COMPOSER_PAYLOAD_CHARS: composerPromptChars,
      COMPOSER_OLLAMA_START: ollamaStart - composerStart,
      COMPOSER_TOTAL_MS: totalMs,
    });

    // ── Phase 6 Final Audit Log ──────────────────────────────────────────────────
    const composerAnswerCharsForAudit = finalAnswer.length;
    log.info("[PHASE6_AUDIT]", {
      llmCalls: 1,
      composerPromptChars,
      composerTokensEstimate: composerPromptTokensEstimate,
      composerAnswerChars: composerAnswerCharsForAudit,
      composerTotalMs: totalMs,
    });
    console.log(
      "[PHASE6_AUDIT]" +
      " llmCalls=1" +
      " composerPromptChars=" + composerPromptChars +
      " composerTokensEstimate=" + composerPromptTokensEstimate +
      " composerAnswerChars=" + composerAnswerCharsForAudit +
      " composerTotalMs=" + totalMs
    );

    return { result: finalAnswer, metadata: { timingMs: totalMs } };
  } finally {
    console.log("[MODULE_INSTANCE]", { file: "responseComposer.ts", event: "end", id: MODULE_INSTANCE_ID, requestId: context.requestId });
  }
}

export default responseComposer;
