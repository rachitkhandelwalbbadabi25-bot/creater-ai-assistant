// ════════════════════════════════════════════════════════════════════════════════
// src/mcp/types.ts — Multi-MCP Architecture Contracts & Types (Phase 8)
// Defines server capabilities, tool schemas, and cross-MCP pipeline interfaces.
// ════════════════════════════════════════════════════════════════════════════════

export type McpServerStatus = "connected" | "degraded" | "disconnected";

export interface McpToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, { type: string; description?: string; required?: boolean }>;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface McpServerInfo {
  name: string;
  version: string;
  status: McpServerStatus;
  description: string;
  tools: Map<string, McpToolDefinition>;
  healthCheck?: () => Promise<boolean>;
}

export interface McpExecutionResult {
  success: boolean;
  serverName: string;
  toolName: string;
  durationMs: number;
  data?: unknown;
  error?: string;
}

export interface McpPipelineStep {
  serverName: string;
  toolName: string;
  params: Record<string, unknown>;
  outputKey?: string;
  forwardResultAs?: string;
}

export interface McpPipelineResult {
  success: boolean;
  stepResults: McpExecutionResult[];
  context: Record<string, unknown>;
  finalOutput?: unknown;
  error?: string;
}

