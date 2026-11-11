// ════════════════════════════════════════════════════════════════════════════════
// src/mcp/registry.ts — Multi-MCP Server Registry (Phase 8)
// Houses discovery, registration, and capabilities of all MCP servers.
// ════════════════════════════════════════════════════════════════════════════════

import { createLogger } from "@utils/logger.js";
import { type McpServerInfo, type McpToolDefinition, type McpServerStatus } from "./types.js";

const log = createLogger("mcp/registry");

class McpRegistry {
  private servers = new Map<string, McpServerInfo>();

  /** Registers a new MCP server with its tool definitions */
  registerServer(
    name: string,
    options: {
      version?: string;
      description?: string;
      healthCheck?: () => Promise<boolean>;
    }
  ): McpServerInfo {
    const existing = this.servers.get(name);
    if (existing) {
      log.debug(`McpServer '${name}' already registered; updating metadata.`);
      existing.version = options.version || existing.version;
      existing.description = options.description || existing.description;
      if (options.healthCheck) existing.healthCheck = options.healthCheck;
      return existing;
    }

    const server: McpServerInfo = {
      name,
      version: options.version || "1.0.0",
      status: "connected",
      description: options.description || `MCP Server for ${name}`,
      tools: new Map<string, McpToolDefinition>(),
      healthCheck: options.healthCheck,
    };

    this.servers.set(name, server);
    log.info(`Registered MCP Server: '${name}' v${server.version}`);
    return server;
  }

  /** Registers a tool under an MCP server */
  registerTool(serverName: string, tool: McpToolDefinition): void {
    let server = this.servers.get(serverName);
    if (!server) {
      server = this.registerServer(serverName, {});
    }
    server.tools.set(tool.name, tool);
    log.debug(`Registered tool '${tool.name}' on MCP server '${serverName}'`);
  }

  /** Retrieves a registered server by name */
  getServer(serverName: string): McpServerInfo | undefined {
    return this.servers.get(serverName);
  }

  /** Retrieves a specific tool definition */
  getTool(serverName: string, toolName: string): McpToolDefinition | undefined {
    return this.servers.get(serverName)?.tools.get(toolName);
  }

  /** Lists all registered MCP servers and their capability summaries */
  listServers(): Array<{
    name: string;
    version: string;
    status: McpServerStatus;
    description: string;
    toolCount: number;
    tools: string[];
  }> {
    return Array.from(this.servers.values()).map((s) => ({
      name: s.name,
      version: s.version,
      status: s.status,
      description: s.description,
      toolCount: s.tools.size,
      tools: Array.from(s.tools.keys()),
    }));
  }

  /** Checks health of all registered servers */
  async checkHealth(): Promise<Record<string, { status: McpServerStatus; healthy: boolean }>> {
    const results: Record<string, { status: McpServerStatus; healthy: boolean }> = {};
    for (const [name, server] of this.servers.entries()) {
      if (server.healthCheck) {
        try {
          const healthy = await server.healthCheck();
          server.status = healthy ? "connected" : "degraded";
          results[name] = { status: server.status, healthy };
        } catch {
          server.status = "degraded";
          results[name] = { status: "degraded", healthy: false };
        }
      } else {
        results[name] = { status: server.status, healthy: server.status === "connected" };
      }
    }
    return results;
  }

  /** Clears all servers (for testing) */
  clear(): void {
    this.servers.clear();
  }
}

export const mcpRegistry = new McpRegistry();

