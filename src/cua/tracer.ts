// ════════════════════════════════════════════════════════════════════════════════
// src/cua/tracer.ts — Phase 8 CUA & Multi-MCP Structured Execution Tracer
// Records stage-level CUA telemetry, perception/UIA/OCR/decision/action latencies,
// execution tier, verification outcomes, and 5-state workflow status with redaction.
// ════════════════════════════════════════════════════════════════════════════════

import { tracer as coreTracer } from "../monitoring/tracer.js";
import { type ExecutionLayer } from "./cuaPolicy.js";

export type CuaExecutionStage =
  | "OBSERVE"
  | "UNDERSTAND"
  | "DECIDE"
  | "ACT"
  | "VERIFY"
  | "RECOVER"
  | "TRACE";

export type CuaWorkflowStatus =
  | "SUCCESS"
  | "PARTIAL_SUCCESS"
  | "FAILED"
  | "NEEDS_USER_INPUT"
  | "AWAITING_APPROVAL";

export interface CuaTelemetryRecord {
  workflowId: string;
  stage: CuaExecutionStage;
  targetApp: string;
  executionTier: ExecutionLayer;
  mcpServer?: string;
  mcpTool?: string;
  perceptionLatencyMs?: number;
  uiaLatencyMs?: number;
  ocrLatencyMs?: number;
  decisionLatencyMs?: number;
  actionLatencyMs?: number;
  overallDurationMs?: number;
  verificationResult?: "VERIFIED" | "NOT_VERIFIED" | "VERIFICATION_UNAVAILABLE";
  retryCount: number;
  recoveryStatus?: "NONE" | "RECOVERED" | "RECOVERY_FAILED";
  finalStatus: CuaWorkflowStatus;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

const SENSITIVE_KEY_PATTERN = /password|passwd|secret|token|cookie|session|otp|mfa|authorization|api_?key|bearer/i;

export function redactSensitiveMetadata(input: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = "[REDACTED]";
    } else if (typeof value === "string" && /(?:Bearer\s+[A-Za-z0-9._-]+|sk-[A-Za-z0-9]{16,})/i.test(value)) {
      out[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = redactSensitiveMetadata(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
  }
  return out;
}

class CuaExecutionTracer {
  private records: CuaTelemetryRecord[] = [];
  private readonly maxRecords = 500;

  recordStage(entry: Omit<CuaTelemetryRecord, "timestamp"> & { timestamp?: number }): CuaTelemetryRecord {
    const safeFinalStatus: CuaWorkflowStatus =
      entry.finalStatus === "SUCCESS" && entry.verificationResult === "NOT_VERIFIED"
        ? "PARTIAL_SUCCESS"
        : entry.finalStatus;

    const record: CuaTelemetryRecord = {
      ...entry,
      finalStatus: safeFinalStatus,
      metadata: redactSensitiveMetadata(entry.metadata),
      timestamp: entry.timestamp ?? Date.now(),
    };

    if (this.records.length >= this.maxRecords) {
      this.records.shift();
    }
    this.records.push(record);

    const active = coreTracer.getActiveContext();
    if (active) {
      const span = coreTracer.startSpan(
        active.traceId,
        `cua:${record.stage.toLowerCase()}:${record.targetApp}`,
        "tool",
        active.parentSpanId,
        record.metadata,
        {
          tier: record.executionTier,
          stage: record.stage,
          status: record.finalStatus,
          retries: record.retryCount,
          ...(record.mcpServer ? { mcpServer: record.mcpServer } : {}),
          ...(record.mcpTool ? { mcpTool: record.mcpTool } : {}),
        }
      );
      coreTracer.endSpan(
        span.id,
        {
          finalStatus: record.finalStatus,
          verificationResult: record.verificationResult,
          perceptionLatencyMs: record.perceptionLatencyMs,
          uiaLatencyMs: record.uiaLatencyMs,
          ocrLatencyMs: record.ocrLatencyMs,
          decisionLatencyMs: record.decisionLatencyMs,
          actionLatencyMs: record.actionLatencyMs,
        },
        record.finalStatus === "FAILED" ? "CUA stage failed" : undefined
      );
    }

    return record;
  }

  listRecords(workflowId?: string): CuaTelemetryRecord[] {
    if (!workflowId) return [...this.records];
    return this.records.filter((r) => r.workflowId === workflowId);
  }

  clear(): void {
    this.records = [];
  }
}

export const cuaTracer = new CuaExecutionTracer();
export { coreTracer as tracer };
