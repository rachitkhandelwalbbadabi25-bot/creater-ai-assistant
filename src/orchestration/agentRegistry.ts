import { plannerAgent } from "../agents/plannerAgent.js";
import { memoryAgent } from "../agents/memoryAgent.js";
import { reasoningAgent } from "../agents/reasoningAgent.js";
import { executionAgent } from "../agents/executionAgent.js";
import { verifierAgent } from "../agents/verifierAgent.js";
import { responseComposer } from "../agents/responseComposer.js";
import type { AgentSharedContext } from "./agentSharedContext.js";
import type { AgentResult } from "./agentBus.js";

/**
 * Capability definitions for each agent. Used for dynamic routing, discovery,
 * and future plugin/MCP compatibility.
 */
export interface AgentCapabilities {
  capabilities: string[];
  agentFn: (ctx: AgentSharedContext) => Promise<AgentResult>;
}

export interface AgentRegistryMap {
  [agentName: string]: AgentCapabilities;
}

/**
 * Central registry of all agents. Extend this to add new agents or plugins.
 */
export const agentRegistry: AgentRegistryMap = {
  plannerAgent: {
    capabilities: ["planning", "task_breakdown"],
    agentFn: plannerAgent as any,
  },
  memoryAgent: {
    capabilities: ["memory_retrieval", "knowledge_search"],
    agentFn: memoryAgent as any,
  },
  reasoningAgent: {
    capabilities: ["analysis", "decision_support"],
    agentFn: reasoningAgent as any,
  },
  executionAgent: {
    capabilities: ["tool_execution", "filesystem", "browser"],
    agentFn: executionAgent as any,
  },
  verifierAgent: {
    capabilities: ["validation", "confidence_scoring"],
    agentFn: verifierAgent as any,
  },
  responseComposer: {
    capabilities: ["compose_response"],
    agentFn: responseComposer as any,
  },
};
