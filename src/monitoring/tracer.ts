// ════════════════════════════════════════════════════════════════════════════════
// src/monitoring/tracer.ts — Unified Execution Tracer & Spans (Phase 7)
// Provides end-to-end observability, timing breakdowns, and tool/agent tracing.
// ════════════════════════════════════════════════════════════════════════════════

import { AsyncLocalStorage } from "async_hooks";
import { createLogger } from "@utils/logger.js";
import { type Trace, type TraceSpan, type SpanType } from "./types.js";
import { recordMetric, incrementCounter } from "./metrics.js";

const log = createLogger("monitoring/tracer");

const MAX_STORED_TRACES = 500;

export interface TraceContext {
  traceId: string;
  parentSpanId?: string;
}

const traceContextStorage = new AsyncLocalStorage<TraceContext>();

class ExecutionTracer {
  private traces = new Map<string, Trace>();
  private activeSpans = new Map<string, TraceSpan>();
  private traceOrder: string[] = [];

  /** Runs an asynchronous function within a scoped trace context */
  runWithContext<T>(context: TraceContext, fn: () => T | Promise<T>): T | Promise<T> {
    return traceContextStorage.run(context, fn);
  }

  /** Gets the active ambient trace context if within an active trace execution */
  getActiveContext(): TraceContext | undefined {
    return traceContextStorage.getStore();
  }

  /** Starts a root trace for an incoming request, workflow, or scheduled task */
  startTrace(rootName: string, metadata?: Record<string, unknown>, customTraceId?: string): Trace {
    const traceId = customTraceId || `tr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const trace: Trace = {
      id: traceId,
      rootName,
      startTime: Date.now(),
      status: "running",
      spans: [],
      metadata: metadata || {},
    };

    // Ring-buffer cleanup
    if (this.traceOrder.length >= MAX_STORED_TRACES) {
      const oldestId = this.traceOrder.shift();
      if (oldestId) {
        this.traces.delete(oldestId);
      }
    }

    this.traces.set(traceId, trace);
    this.traceOrder.push(traceId);
    incrementCounter("traces_started_total");

    return trace;
  }

  /** Starts a child span within an active trace (agent, tool, model, db, or workflow) */
  startSpan(
    traceId: string,
    name: string,
    type: SpanType,
    parentSpanId?: string,
    input?: unknown,
    tags?: Record<string, string | number | boolean>
  ): TraceSpan {
    const spanId = `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const span: TraceSpan = {
      id: spanId,
      traceId,
      parentSpanId: parentSpanId || this.getActiveContext()?.parentSpanId,
      name,
      type,
      startTime: Date.now(),
      status: "running",
      tags: tags || {},
      input,
    };

    this.activeSpans.set(spanId, span);

    const trace = this.traces.get(traceId);
    if (trace) {
      trace.spans.push(span);
    }

    return span;
  }

  /** Ends an active span, calculating duration and recording telemetry metrics */
  endSpan(spanId: string, output?: unknown, error?: Error | string): TraceSpan | undefined {
    const span = this.activeSpans.get(spanId);
    if (!span) return undefined;

    span.endTime = Date.now();
    span.durationMs = Math.max(0, span.endTime - span.startTime);
    span.output = output;

    if (error) {
      span.status = "failed";
      span.error = typeof error === "string" ? error : error?.message || String(error);
      incrementCounter(`span_failures_${span.type}`);
    } else {
      span.status = "completed";
      incrementCounter(`span_successes_${span.type}`);
    }

    // Record timing metric
    recordMetric({ name: `span_duration_${span.type}_ms`, value: span.durationMs });

    this.activeSpans.delete(spanId);
    return span;
  }

  /** Completes a root trace */
  endTrace(traceId: string, status?: "completed" | "failed", error?: string): Trace | undefined {
    const trace = this.traces.get(traceId);
    if (!trace) return undefined;

    trace.endTime = Date.now();
    trace.durationMs = Math.max(0, trace.endTime - trace.startTime);

    if (status) {
      trace.status = status;
    } else {
      const hasFailedSpan = trace.spans.some((s) => s.status === "failed");
      trace.status = hasFailedSpan ? "failed" : "completed";
    }

    if (error) {
      trace.metadata = { ...trace.metadata, error };
    }

    recordMetric({ name: "trace_duration_ms", value: trace.durationMs });
    return trace;
  }

  /** Convenient helper to trace an async function block */
  async trace<T>(
    name: string,
    type: SpanType,
    fn: (span: TraceSpan) => Promise<T>,
    tags?: Record<string, string | number | boolean>,
    input?: unknown
  ): Promise<T> {
    const active = this.getActiveContext();
    if (!active) {
      const rootTrace = this.startTrace(name, { autoRoot: true });
      return this.runWithContext({ traceId: rootTrace.id }, async () => {
        const span = this.startSpan(rootTrace.id, name, type, undefined, input, tags);
        try {
          const res = await this.runWithContext({ traceId: rootTrace.id, parentSpanId: span.id }, () => fn(span));
          this.endSpan(span.id, res);
          this.endTrace(rootTrace.id, "completed");
          return res;
        } catch (err: any) {
          this.endSpan(span.id, undefined, err);
          this.endTrace(rootTrace.id, "failed", err?.message || String(err));
          throw err;
        }
      }) as Promise<T>;
    }

    const span = this.startSpan(active.traceId, name, type, active.parentSpanId, input, tags);
    try {
      const res = await this.runWithContext({ traceId: active.traceId, parentSpanId: span.id }, () => fn(span));
      this.endSpan(span.id, res);
      return res;
    } catch (err: any) {
      this.endSpan(span.id, undefined, err);
      throw err;
    }
  }

  /** Retrieves a trace by ID */
  getTrace(traceId: string): Trace | undefined {
    return this.traces.get(traceId);
  }

  /** Lists the most recent traces */
  listTraces(limit = 50, filter?: { status?: "running" | "completed" | "failed"; rootName?: string }): Trace[] {
    let result = Array.from(this.traces.values());

    if (filter?.status) {
      result = result.filter((t) => t.status === filter.status);
    }
    if (filter?.rootName) {
      result = result.filter((t) => t.rootName.includes(filter.rootName!));
    }

    return result.slice(-limit).reverse();
  }

  /** Generates a formatted ASCII execution tree for terminal debugging */
  formatTraceTimeline(traceId: string): string {
    const trace = this.traces.get(traceId);
    if (!trace) return `Trace ${traceId} not found.`;

    const lines: string[] = [
      `Trace: ${trace.rootName} [${trace.id}] (${trace.status.toUpperCase()}) — ${trace.durationMs ?? 0}ms`,
      `Started: ${new Date(trace.startTime).toISOString()}`,
      `Spans: ${trace.spans.length}`,
      "----------------------------------------------------------------------",
    ];

    for (const span of trace.spans) {
      const indent = span.parentSpanId ? "  └─ " : "├─ ";
      const dur = span.durationMs !== undefined ? `${span.durationMs}ms` : "in-flight";
      const statusIcon = span.status === "completed" ? "✓" : span.status === "failed" ? "✗" : "⏳";
      lines.push(`${indent}[${span.type.toUpperCase()}] ${span.name}: ${statusIcon} ${dur}`);
      if (span.error) {
        lines.push(`     Error: ${span.error}`);
      }
    }

    return lines.join("\n");
  }

  /** Clears all stored traces (used in test suites) */
  clear(): void {
    this.traces.clear();
    this.activeSpans.clear();
    this.traceOrder = [];
  }
}

export const tracer = new ExecutionTracer();
