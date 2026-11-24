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
  type McpPipelineCheckpoint,
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
      handler: (p) =>
        sysTools.adjustVolume(
          p.direction as "up" | "down" | "mute" | "unmute" | "set",
          p.value as number | undefined
        ),
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
      handler: (p) =>
        desktopControl.clickDesktop(
          p.x as number,
          p.y as number,
          (p.button as "left" | "right" | "middle" | "double") || "left"
        ),
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
    mcpRegistry.registerTool("desktop", {
      name: "inspect_browser",
      description: "Inspect live desktop browser surface via UIA and WinRT OCR",
      parameters: { target: { type: "string" }, siteHint: { type: "string" } },
      handler: (p) =>
        desktopControl.inspectDesktopBrowserSurface(
          (p.target as string) || "chrome",
          p.siteHint as string | undefined
        ),
    });
    mcpRegistry.registerTool("desktop", {
      name: "write_app",
      description: "Type verified text directly into a desktop application via Win32 SendInput",
      parameters: { target: { type: "string", required: true }, text: { type: "string", required: true } },
      handler: (p) => desktopControl.writeToDesktopApp(p.target as string, p.text as string),
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
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.error(`MCP execution failed for '${serverName}.${toolName}'`, { error: errMsg });
      return {
        success: false,
        serverName,
        toolName,
        durationMs: Date.now() - startTime,
        error: errMsg,
      };
    }
  }

  private resolveStepParams(
    step: McpPipelineStep,
    context: Record<string, unknown>,
    lastOutput: unknown
  ): Record<string, unknown> {
    const mergedParams = { ...step.params };
    if (step.forwardResultAs && lastOutput !== undefined) {
      mergedParams[step.forwardResultAs] = lastOutput;
    }
    for (const [k, v] of Object.entries(mergedParams)) {
      if (typeof v === "string" && v.startsWith("{context.") && v.endsWith("}")) {
        const varName = v.slice(9, -1);
        if (context[varName] !== undefined) {
          mergedParams[k] = context[varName];
        }
      }
    }
    return mergedParams;
  }

  private async executeStepWithRetry(
    step: McpPipelineStep,
    mergedParams: Record<string, unknown>
  ): Promise<McpExecutionResult> {
    const maxAttempts = Math.max(1, (step.retries ?? 0) + 1);
    let lastRes: McpExecutionResult = {
      success: false,
      serverName: step.serverName,
      toolName: step.toolName,
      durationMs: 0,
      error: "Not executed",
    };
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      lastRes = await this.callTool(step.serverName, step.toolName, mergedParams);
      if (lastRes.success) return lastRes;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 120 * attempt));
      }
    }
    return lastRes;
  }

  /**
   * Executes a multi-step cross-MCP pipeline supporting sequential steps,
   * parallel step groups (parallelGroup), dependency checks (dependsOn),
   * bounded retries (retries), and checkpoint recording.
   */
  async executePipeline(steps: McpPipelineStep[]): Promise<McpPipelineResult> {
    if (!this.initialized) {
      await this.initializeDefaults();
    }

    const stepResults: McpExecutionResult[] = [];
    const context: Record<string, unknown> = {};
    const checkpoints: McpPipelineCheckpoint[] = [];
    let lastOutput: unknown = undefined;

    let i = 0;
    while (i < steps.length) {
      const step = steps[i];

      // Verify required dependency keys exist in context
      if (step.dependsOn && step.dependsOn.length > 0) {
        const missingDep = step.dependsOn.find((depKey) => !(depKey in context));
        if (missingDep) {
          return {
            success: false,
            stepResults,
            context,
            checkpoints,
            error: `Pipeline halted at step ${i + 1} (${step.serverName}.${step.toolName}): Missing dependency '${missingDep}'`,
          };
        }
      }

      // Check if consecutive steps share a parallelGroup
      if (step.parallelGroup) {
        const groupName = step.parallelGroup;
        const batch: Array<{ index: number; step: McpPipelineStep }> = [];
        while (i < steps.length && steps[i].parallelGroup === groupName) {
          batch.push({ index: i, step: steps[i] });
          i++;
        }

        const batchResults = await Promise.all(
          batch.map(async (item) => {
            const params = this.resolveStepParams(item.step, context, lastOutput);
            const res = await this.executeStepWithRetry(item.step, params);
            return { ...item, res };
          })
        );

        for (const item of batchResults) {
          stepResults.push(item.res);
          checkpoints.push({
            stepIndex: item.index,
            serverName: item.step.serverName,
            toolName: item.step.toolName,
            outputKey: item.step.outputKey,
            success: item.res.success,
            timestamp: Date.now(),
          });
          if (!item.res.success) {
            return {
              success: false,
              stepResults,
              context,
              checkpoints,
              error: `Pipeline halted at parallel step ${item.index + 1} (${item.step.serverName}.${item.step.toolName}): ${item.res.error}`,
            };
          }
          lastOutput = item.res.data;
          if (item.step.outputKey) {
            context[item.step.outputKey] = item.res.data !== undefined ? item.res.data : true;
          }
        }
        continue;
      }

      const mergedParams = this.resolveStepParams(step, context, lastOutput);
      const result = await this.executeStepWithRetry(step, mergedParams);
      stepResults.push(result);
      checkpoints.push({
        stepIndex: i,
        serverName: step.serverName,
        toolName: step.toolName,
        outputKey: step.outputKey,
        success: result.success,
        timestamp: Date.now(),
      });

      if (!result.success) {
        return {
          success: false,
          stepResults,
          context,
          checkpoints,
          error: `Pipeline halted at step ${i + 1} (${step.serverName}.${step.toolName}): ${result.error}`,
        };
      }

      lastOutput = result.data;
      if (step.outputKey) {
        context[step.outputKey] = result.data !== undefined ? result.data : true;
      }
      i++;
    }

    return {
      success: true,
      stepResults,
      context,
      checkpoints,
      finalOutput: lastOutput,
    };
  }
}

export const mcpCoordinator = new McpCoordinator();

