// src/orchestration/agentSharedContext.ts

/**
 * Shared execution context passed to all agents in the multi‑agent pipeline.
 */
export interface AgentSharedContext {
  /** Unique identifier for the whole request */
  requestId: string;
  /** Identifier of the user who initiated the request */
  userId?: string;
  /** Execution mode: legacy or multi‑agent */
  executionMode: "legacy" | "multi-agent";
  /** Snapshot of relevant memory data (populated by Memory Agent) */
  memorySnapshot?: any;
  /** Context retrieved from knowledge bases, graph, etc. */
  retrievedContext?: any;
  /** History of agent executions (name & timing) */
  executionHistory?: Array<{ agent: string; timingMs: number }>
  /** Aggregated timing metrics for the workflow */
  timingMetrics?: Record<string, number>;
}
