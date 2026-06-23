// -------------------------------------------------------------------------------
// src/utils/latencyTracker.ts - Non-invasive latency audit tracker
// Only active when ENABLE_LATENCY_AUDIT=true
// -------------------------------------------------------------------------------

import * as fs from "fs";
import * as path from "path";
import { createLogger } from "./logger.js";

const log = createLogger("utils/latencyTracker");

interface StageRecord {
  stage: string;
  startMs: number;
  endMs?: number;
  durationMs?: number;
}

interface RequestTrace {
  requestId: string;
  startEpoch: number;
  stages: StageRecord[];
}

const activeTraces = new Map<string, RequestTrace>();

function begin(requestId: string): void {
  activeTraces.set(requestId, {
    requestId,
    startEpoch: Date.now(),
    stages: [],
  });
}

function mark(requestId: string, stage: string): void {
  const trace = activeTraces.get(requestId);
  if (!trace) return;
  const now = Date.now() - trace.startEpoch;
  trace.stages.push({ stage, startMs: now });
}

function endMark(requestId: string, stage: string): void {
  const trace = activeTraces.get(requestId);
  if (!trace) return;
  const now = Date.now() - trace.startEpoch;
  const existing = trace.stages.find((s) => s.stage === stage && s.endMs == null);
  if (existing) {
    existing.endMs = now;
    existing.durationMs = now - existing.startMs;
  } else {
    trace.stages.push({ stage, startMs: now, endMs: now, durationMs: 0 });
  }
}

function report(requestId: string, ollamaStages: Record<string, number>): void {
  const trace = activeTraces.get(requestId);
  if (!trace) {
    // No full trace — just log ollama stages
    log.info(`[LatencyAudit] Ollama stages for ${requestId}`, ollamaStages);
    return;
  }

  // Merge ollama stages into trace
  for (const [key, value] of Object.entries(ollamaStages)) {
    if (value > 0) {
      trace.stages.push({ stage: `Ollama.${key}`, startMs: value, durationMs: value });
    }
  }

  const totalMs = Date.now() - trace.startEpoch;

  const reportData = {
    requestId,
    totalMs,
    startEpoch: trace.startEpoch,
    stages: trace.stages,
  };

  // Console output
  log.info(`[LatencyAudit] Report for ${requestId}`, reportData);

  // Write JSON report
  try {
    const scratchDir = path.resolve("scratch");
    if (!fs.existsSync(scratchDir)) {
      fs.mkdirSync(scratchDir, { recursive: true });
    }
    const safeId = requestId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const jsonPath = path.join(scratchDir, `latency-${safeId}-${Date.now()}.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(reportData, null, 2));

    // Write Markdown report
    const mdPath = path.join(scratchDir, `latency-${safeId}-${Date.now()}.md`);
    const rows = trace.stages
      .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
      .map((s) => `| ${s.stage} | ${s.startMs}ms | ${s.endMs ?? "—"} | ${s.durationMs ?? "—"} |`)
      .join("\n");
    const md = `# Latency Report: ${requestId}\n\n**Total:** ${totalMs}ms\n\n| Stage | Start | End | Duration |\n|-------|-------|-----|----------|\n${rows}\n`;
    fs.writeFileSync(mdPath, md);
  } catch (err) {
    log.warn("Failed to write latency report", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Cleanup
  activeTraces.delete(requestId);
}

function finish(requestId: string): void {
  const trace = activeTraces.get(requestId);
  if (!trace) return;
  report(requestId, {});
}

export const latencyTracker = {
  begin,
  mark,
  endMark,
  report,
  finish,
};
