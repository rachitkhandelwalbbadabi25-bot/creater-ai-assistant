// ════════════════════════════════════════════════════════════════════════════════
// src/mcp/coordinator.ts — Multi-MCP Unified Coordinator (Phase 8)
// Orchestrates multi-server MCP operations, execution pipelines, and tool routing.
// ════════════════════════════════════════════════════════════════════════════════

import { createLogger } from "@utils/logger.js";
import { mcpRegistry } from "./registry.js";
import {
  type McpExecutionResult,
  type McpPipelineStep,
  type McpPipelineResult,
} from "./types.js";
import { tracer } from "../monitoring/tracer.js";

const log = createLogger("mcp/coordinator");

class McpCoordinator {
  private initialized = false;

  /** Initializes default built-in MCP servers and tools */
  async initializeDefaults(): Promise<void> {
    if (this.initialized) return;

    log.info("Initializing built-in MCP servers...");

    // 1. Filesystem MCP Server
    mcpRegistry.registerServer("filesystem", {
      version: "1.0.0",
      description: "Direct file system read, write, directory, and search operations",
    });

    const fsTools = await import("../tools/laptop/fileSystem.js");
    mcpRegistry.registerTool("filesystem", {
      name: "read_file",
      description: "Read file contents",
      parameters: { path: { type: "string", required: true } },
      handler: (p) => fsTools.readFileContent(p.path as string),
    });
    mcpRegistry.registerTool("filesystem", {
      name: "write_file",
      description: "Write text content to file",
      parameters: { path: { type: "string", required: true }, content: { type: "string", required: true } },
      handler: (p) => fsTools.writeFileContent(p.path as string, p.content as string),
    });
    mcpRegistry.registerTool("filesystem", {
      name: "list_directory",
      description: "List files and directories",
      parameters: { path: { type: "string", required: true } },
      handler: (p) => fsTools.listDirectory(p.path as string),
    });
    mcpRegistry.registerTool("filesystem", {
      name: "delete_file",
      description: "Delete file",
      parameters: { path: { type: "string", required: true } },
      handler: (p) => fsTools.deleteFile(p.path as string),
    });

    // 2. OS MCP Server
    mcpRegistry.registerServer("os", {
      version: "1.0.0",
      description: "Operating system operations, screenshots, processes, and notifications",
    });

    const osOps = await import("./os/osOps.js");
    const sysTools = await import("../tools/laptop/system.js");
    mcpRegistry.registerTool("os", {
      name: "screenshot",
      description: "Capture desktop screenshot",
      parameters: {},
      handler: async () => {
        const filePath = await osOps.screenshot();
        return { success: true, filePath };
      },
    });
    mcpRegistry.registerTool("os", {
      name: "clipboard",
      description: "Read or write system clipboard",
      parameters: { action: { type: "string", required: true }, text: { type: "string" } },
      handler: (p) => osOps.clipboard(p.action as "read" | "write", p.text as string | undefined),
    });
    mcpRegistry.registerTool("os", {
      name: "system_info",
      description: "Retrieve hardware and OS metadata",
      parameters: {},
      handler: () => sysTools.getSystemInfo(),
    });
    mcpRegistry.registerTool("os", {
      name: "volume",
      description: "Adjust or set master system volume",
      parameters: { direction: { type: "string", required: true }, value: { type: "number" } },
      handler: (p) => sysTools.adjustVolume(p.direction as any, p.value as number | undefined),
    });

    // 3. Desktop / CUA MCP Server
    mcpRegistry.registerServer("desktop", {
      version: "1.0.0",
      description: "Native desktop GUI controls, mouse clicks, keyboard input, and window focus",
    });

    const desktopControl = await import("../tools/laptop/desktopControl.js");
    mcpRegistry.registerTool("desktop", {
      name: "click",
      description: "Click at absolute desktop coordinates",
      parameters: { x: { type: "number", required: true }, y: { type: "number", required: true }, button: { type: "string" } },
      handler: (p) => desktopControl.clickDesktop(p.x as number, p.y as number, (p.button as any) || "left"),
    });
    mcpRegistry.registerTool("desktop", {
      name: "move",
      description: "Move mouse cursor to absolute desktop coordinates",
      parameters: { x: { type: "number", required: true }, y: { type: "number", required: true } },
      handler: (p) => desktopControl.moveDesktopMouse(p.x as number, p.y as number),
    });
    mcpRegistry.registerTool("desktop", {
      name: "type",
      description: "Type text into active desktop window",
      parameters: { text: { type: "string", required: true } },
      handler: (p) => desktopControl.typeDesktopText(p.text as string),
    });
    mcpRegistry.registerTool("desktop", {
      name: "key",
      description: "Send keypress or shortcut to active desktop window",
      parameters: { key: { type: "string", required: true } },
      handler: (p) => desktopControl.pressDesktopKey(p.key as string),
    });
    mcpRegistry.registerTool("desktop", {
      name: "active_window",
      description: "Get title, PID, and bounds of currently focused window",
      parameters: {},
      handler: () => desktopControl.getActiveDesktopWindow(),
    });
    mcpRegistry.registerTool("desktop", {
      name: "focus_window",
      description: "Focus window by title or PID",
      parameters: { target: { type: "string", required: true } },
      handler: (p) => desktopControl.focusDesktopWindow(p.target as string),
    });

    // 4. Browser MCP Server
    mcpRegistry.registerServer("browser", {
      version: "1.0.0",
      description: "Browser automation, DOM extraction, and navigation",
    });

    const browserTools = await import("../tools/laptop/browser.js");
    mcpRegistry.registerTool("browser", {
      name: "navigate",
      description: "Navigate browser to URL",
      parameters: { url: { type: "string", required: true } },
      handler: (p) => browserTools.navigateToUrl(p.url as string),
    });
    mcpRegistry.registerTool("browser", {
      name: "extract_text",
      description: "Extract text content from URL",
      parameters: { url: { type: "string", required: true } },
      handler: (p) => browserTools.extractText(p.url as string),
    });

    this.initialized = true;
    log.info("Built-in MCP servers successfully initialized.");
  }

  /** Calls a tool on any registered MCP server with auto-tracing */
  async callTool(serverName: string, toolName: string, params: Record<string, unknown> = {}): Promise<McpExecutionResult> {
    if (!this.initialized) {
      await this.initializeDefaults();
    }

    const tool = mcpRegistry.getTool(serverName, toolName);
    if (!tool) {
      return {
        success: false,
        serverName,
        toolName,
        durationMs: 0,
        error: `MCP Tool '${serverName}.${toolName}' not found in registry.`,
      };
    }

    const startTime = Date.now();
    try {
      const data = await tracer.trace(
        `mcp:${serverName}.${toolName}`,
        "tool",
        async () => tool.handler(params),
        { server: serverName, tool: toolName }
      );
      return {
        success: true,
        serverName,
        toolName,
        durationMs: Date.now() - startTime,
        data,
      };
    } catch (err: any) {
      log.error(`MCP execution failed for '${serverName}.${toolName}'`, err);
      return {
        success: false,
        serverName,
        toolName,
        durationMs: Date.now() - startTime,
        error: err.message || String(err),
      };
    }
  }

  /**
   * Executes a multi-step cross-MCP pipeline where data from one MCP server
   * is forwarded to the next (e.g. OS screenshot -> Desktop OCR/Visual Anchor -> Desktop Click).
   */
  async executePipeline(steps: McpPipelineStep[]): Promise<McpPipelineResult> {
    if (!this.initialized) {
      await this.initializeDefaults();
    }

    const stepResults: McpExecutionResult[] = [];
    const context: Record<string, unknown> = {};
    let lastOutput: unknown = undefined;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const mergedParams = { ...step.params };

      // Forward output from previous step if requested
      if (step.forwardResultAs && lastOutput !== undefined) {
        mergedParams[step.forwardResultAs] = lastOutput;
      }

      // Interpolate any {context.key} parameters
      for (const [k, v] of Object.entries(mergedParams)) {
        if (typeof v === "string" && v.startsWith("{context.") && v.endsWith("}")) {
          const varName = v.slice(9, -1);
          if (context[varName] !== undefined) {
            mergedParams[k] = context[varName];
          }
        }
      }

      const result = await this.callTool(step.serverName, step.toolName, mergedParams);
      stepResults.push(result);

      if (!result.success) {
        return {
          success: false,
          stepResults,
          context,
          error: `Pipeline halted at step ${i + 1} (${step.serverName}.${step.toolName}): ${result.error}`,
        };
      }

      lastOutput = result.data;
      if (step.outputKey) {
        context[step.outputKey] = result.data;
      }
    }

    return {
      success: true,
      stepResults,
      context,
      finalOutput: lastOutput,
    };
  }
}

export const mcpCoordinator = new McpCoordinator();

