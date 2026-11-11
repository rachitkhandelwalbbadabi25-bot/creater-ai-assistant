import * as fsTools from "./laptop/fileSystem.js";
import * as shellTools from "./laptop/executor.js";
import * as systemTools from "./laptop/system.js";
import * as editorTools from "./laptop/editor.js";
import * as launcherTools from "./laptop/launcher.js";
import { ToolError } from "@utils/errorHandler.js";
import { createLogger } from "@utils/logger.js";
import { IS_RUNTIME_DEBUG, logPerf, nowMs } from "@utils/perf.js";
import { RuntimeCommand } from "../runtime/runtimeCommand.js";
import { validateCommand } from "../runtime/semantic/runtimeBridge.js";
import { tracer } from "../monitoring/tracer.js";

const log = createLogger("tools/dispatcher");

type ToolParams = Record<string, unknown>;
type ToolResult = unknown;
type ToolHandler = (params: ToolParams) => Promise<ToolResult>;

const FAST_TOOLS: Record<string, ToolHandler> = {
  "fs.read_file": (params) => fsTools.readFileContent(params.path as string, params.encoding as BufferEncoding | undefined),
  "fs.write_file": (params) => fsTools.writeFileContent(params.path as string, params.content as string, params.append as boolean | undefined),
  "fs.delete_file": (params) => fsTools.deleteFile(params.path as string),
  "fs.list_directory": (params) => fsTools.listDirectory(params.path as string, params.pattern as string | undefined),
  "fs.create_directory": (params) => fsTools.createDirectory(params.path as string),
  "fs.move_file": (params) => fsTools.moveFile(params.src as string, params.dest as string),
  "fs.copy_file": (params) => fsTools.copyFile(params.src as string, params.dest as string),
  "fs.search_files": (params) => fsTools.searchFiles(params.query as string, params.base_dir as string | undefined),
  "fs.file_metadata": (params) => fsTools.getFileMetadata(params.path as string),
  "shell.execute": (params) => shellTools.executeCommand(params.command as string, params.cwd as string | undefined, params.timeout_ms as number | undefined),
  "shell.execute_dangerous": (params) => shellTools.executeCommand(params.command as string),
  "system.info": () => systemTools.getSystemInfo(),
  "system.volume": (params) => systemTools.adjustVolume(
    (params.direction as "up" | "down" | "mute" | "unmute" | "set") || "up",
    typeof params.value === "number" ? params.value : 10
  ),
  "system.screenshot": async () => {
    const { screenshot } = await import("../mcp/os/osOps.js");
    const filePath = await screenshot();
    return { success: true, filePath, message: `Screenshot saved to ${filePath}` };
  },
  "system.process_list": (params) => systemTools.getProcesses(params.top_n as number | undefined),
  "system.process_kill": (params) => systemTools.killProcess(params.pid as number),
  "system.clipboard": (params) => systemTools.clipboardOp(params.action as "read" | "write", params.text as string | undefined),
  "system.env": (params) => systemTools.getEnvironmentVars(params.keys as string[] | undefined),
  "system.notify": async (params) => {
    const { deliverNotification } = await import("../scheduler/notificationService.js");
    const result = await deliverNotification({
      title: (params.title as string) || "Creater AI — Reminder",
      body: (params.message as string) || (params.body as string) || "You have a reminder.",
      reminderTitle: params.reminderTitle as string | undefined,
      scheduledAt: params.scheduledAt as string | number | undefined,
      jobId: params.jobId as string | undefined,
      occurrenceKey: params.occurrenceKey as string | undefined,
    });
    if (!result.success) {
      throw new Error(`Notification failed: ${result.error || "delivery failure"}`);
    }
    return {
      success: true,
      message: "Notification delivered",
      channel: result.channel,
    };
  },
  "system.open_app": (params) => launcherTools.openApp(params.app as string),
  "system.open_path": (params) => launcherTools.openFileOrPath(params.path as string),
  "reminder.create": async (params) => {
    const reminderTools = await import("../scheduler/reminderTools.js");
    return reminderTools.createReminder({
      title: params.title as string | undefined,
      timeInput: params.timeInput as string | undefined,
      scheduledAt: params.scheduledAt as string | number | undefined,
      timezone: params.timezone as string | undefined,
      channel: (params.channel as string) || "tui",
    });
  },
  "reminder.list": async (params) => {
    const reminderTools = await import("../scheduler/reminderTools.js");
    return reminderTools.listReminders();
  },
  "reminder.query": async (params) => {
    const reminderTools = await import("../scheduler/reminderTools.js");
    return reminderTools.queryReminders({
      queryType: params?.queryType as "latest" | "all" | undefined,
      channel: (params?.channel as string) || "tui",
    });
  },
  "reminder.cancel": async (params) => {
    const reminderTools = await import("../scheduler/reminderTools.js");
    return reminderTools.cancelReminder((params.query || params.id || "") as string);
  },
  // "browser.navigate" now uses Playwright via heavy loader
  // Removed fast tool mapping to avoid OS-level URL opening
  "editor.open_file": (params) => editorTools.openInVSCode(params.path as string, params.line as number | undefined),
  "git.status": (params) => editorTools.gitStatus(params.repo_path as string),
  "git.commit": (params) => editorTools.gitCommit(params.repo_path as string, params.message as string),
  "system.diagnostics": async () => {
    const { getDashboard } = await import("../monitoring/dashboard.js");
    return getDashboard();
  },
  "system.traces": async (params) => {
    const { tracer } = await import("../monitoring/tracer.js");
    if (params?.traceId && typeof params.traceId === "string") {
      return {
        trace: tracer.getTrace(params.traceId),
        timeline: tracer.formatTraceTimeline(params.traceId),
      };
    }
    const limit = typeof params?.limit === "number" ? params.limit : 20;
    return {
      traces: tracer.listTraces(limit),
    };
  },
  "workflow.replay": async (params) => {
    const { workflowReplayManager } = await import("../monitoring/workflowReplay.js");
    const workflowId = params.workflowId as string;
    if (!workflowId) {
      throw new Error("Missing required 'workflowId' parameter for workflow.replay");
    }
    return workflowReplayManager.replayWorkflow(workflowId, {
      fromStepId: params.fromStepId as string | undefined,
      contextOverrides: params.contextOverrides as Record<string, unknown> | undefined,
    });
  },
  "mcp.list_servers": async () => {
    const { mcpCoordinator } = await import("../mcp/coordinator.js");
    const { mcpRegistry } = await import("../mcp/registry.js");
    await mcpCoordinator.initializeDefaults();
    return mcpRegistry.listServers();
  },
  "mcp.call_tool": async (params) => {
    const { mcpCoordinator } = await import("../mcp/coordinator.js");
    return mcpCoordinator.callTool(
      params.server as string,
      params.tool as string,
      (params.params as Record<string, unknown>) || {}
    );
  },
  "mcp.pipeline": async (params) => {
    const { mcpCoordinator } = await import("../mcp/coordinator.js");
    return mcpCoordinator.executePipeline(params.steps as any);
  },
  "cua.execute": async (params) => {
    const { advancedCuaEngine } = await import("../cua/cuaEngine.js");
    return advancedCuaEngine.execute(params as any);
  },
  "cua.click": async (params) => {
    const { clickDesktop } = await import("./laptop/desktopControl.js");
    return clickDesktop(params.x as number, params.y as number, (params.button as any) || "left");
  },
  "cua.type": async (params) => {
    const { typeDesktopText } = await import("./laptop/desktopControl.js");
    return typeDesktopText(params.text as string);
  },
  "cua.key": async (params) => {
    const { pressDesktopKey } = await import("./laptop/desktopControl.js");
    return pressDesktopKey(params.key as string);
  },
  "cua.active_window": async () => {
    const { getActiveDesktopWindow } = await import("./laptop/desktopControl.js");
    return getActiveDesktopWindow();
  },
  "cua.focus_window": async (params) => {
    const { focusDesktopWindow } = await import("./laptop/desktopControl.js");
    return focusDesktopWindow(params.target as string);
  },
  "browser.autonomous_act": async (params) => {
    const { runAutonomousWebTask } = await import("../mcp/browser/universalWebOperator.js");
    return runAutonomousWebTask({
      goal: params.goal as string,
      startUrl: params.startUrl as string | undefined,
      maxSteps: params.maxSteps as number | undefined,
      dryRun: params.dryRun as boolean | undefined,
    });
  },
  "social.send_message": async (params) => {
    const { runAutonomousWebTask } = await import("../mcp/browser/universalWebOperator.js");
    const goal = `Send message to ${params.recipient} on ${params.platform}: ${params.message}`;
    return runAutonomousWebTask({
      goal,
      dryRun: params.dryRun as boolean | undefined,
    });
  },
};

const HEAVY_TOOL_LOADERS: Record<string, () => Promise<ToolHandler>> = {
  "browser.extract_text": async () => {
    const browserTools = await import("./laptop/browser.js");
    return (params) => browserTools.extractText(params.url as string);
  },
  "browser.screenshot": async () => {
    const browserTools = await import("./laptop/browser.js");
    return (params) => browserTools.takeScreenshot(params.url as string, (params.savePath as string | undefined) || `./screenshot_${Date.now()}.png`);
  },
  // New heavy loader for navigation using Playwright
  "browser.navigate": async () => {
    const browserTools = await import("./laptop/browser.js");
    return (params) => browserTools.navigateToUrl(params.url as string);
  },
  "computer.open_browser": async () => {
    const computerTools = await import("./laptop/computer.js");
    return (params) => computerTools.openBrowser(params.url as string | undefined);
  },
  "computer.navigate": async () => {
    const computerTools = await import("./laptop/computer.js");
    return (params) => computerTools.navigateTo(params.url as string);
  },
  "computer.click": async () => {
    const computerTools = await import("./laptop/computer.js");
    return (params) => computerTools.clickAt(params.x as number, params.y as number);
  },
  "computer.click_selector": async () => {
    const computerTools = await import("./laptop/computer.js");
    return (params) => computerTools.clickSelector(params.selector as string);
  },
  "computer.type": async () => {
    const computerTools = await import("./laptop/computer.js");
    return (params) => computerTools.typeText(params.text as string, params.selector as string | undefined);
  },
  "computer.press_key": async () => {
    const computerTools = await import("./laptop/computer.js");
    return (params) => computerTools.pressKey(params.key as string);
  },
  "computer.shortcut": async () => {
    const computerTools = await import("./laptop/computer.js");
    return (params) => computerTools.keyboardShortcut(params.shortcut as string);
  },
  "computer.scroll": async () => {
    const computerTools = await import("./laptop/computer.js");
    return (params) => computerTools.scrollPage(params.direction as "up" | "down", params.amount as number | undefined);
  },
  "computer.screenshot": async () => {
    const computerTools = await import("./laptop/computer.js");
    return () => computerTools.takeScreenshotOfPage();
  },
  "computer.get_text": async () => {
    const computerTools = await import("./laptop/computer.js");
    return () => computerTools.getPageText();
  },
  "computer.fill_form": async () => {
    const computerTools = await import("./laptop/computer.js");
    return (params) => computerTools.fillForm(params.selector as string, params.value as string);
  },
  "computer.play_youtube": async () => {
    const computerTools = await import("./laptop/computer.js");
    return (params) => computerTools.playYouTube(
      params.query as string,
      (params.action as "play" | "search") || "play",
      (params.selection as "first") || "first"
    );
  },
  "computer.close_browser": async () => {
    const computerTools = await import("./laptop/computer.js");
    return () => computerTools.closeBrowserWindow();
  },
};

const heavyToolCache = new Map<string, ToolHandler>();

async function executeToolInternal(toolId: string, params: ToolParams, startedAt: number): Promise<ToolResult> {
  // Handle standardized RuntimeCommands
  if (toolId === RuntimeCommand.CHAT) {
    const validation = validateCommand(RuntimeCommand.CHAT, params);
    if (!validation.valid) {
      return { success: false, response: validation.reason ?? "Invalid chat command" };
    }
    const { chat } = await import("../llm/client.js");
    const { SYSTEM_PROMPT } = await import("../llm/prompts.js");
    const { GenerationPresets, Models } = await import("../config/models.js");
    const messages = [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content: params.input as string }
    ];
    const response = await chat({
      model: Models.PRIMARY,
      messages,
      options: GenerationPresets.conversational
    });
    return { success: true, response };
  }

  if (toolId === RuntimeCommand.WEB_SEARCH) {
    const validation = validateCommand(RuntimeCommand.WEB_SEARCH, params);
    if (!validation.valid) {
      return { success: false, response: validation.reason ?? "Invalid web search command" };
    }
    const { openUrl } = await import("./laptop/launcher.js");
    const query = params.query as string;
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    try {
      await openUrl(url);
      return { success: true, response: `Searching Google for "${query}"...` };
    } catch {
      await openUrl("https://www.google.com");
      await openUrl(url);
      return { success: true, response: `Searching Google for "${query}"...` };
    }
  }

  try {
    const fastTool = FAST_TOOLS[toolId];
    if (fastTool) {
      if (toolId === "browser.navigate" && IS_RUNTIME_DEBUG) {
        log.info("PLAYWRIGHT BYPASS ACTIVE", { url: params.url });
      }
      const result = await fastTool(params);
      logPerf(log, `dispatchTool:${toolId}`, startedAt, { path: "fast" });
      return result;
    }

    let heavyTool = heavyToolCache.get(toolId);
    if (!heavyTool) {
      const loader = HEAVY_TOOL_LOADERS[toolId];
      if (!loader) {
        throw new ToolError(toolId, `No implementation found for tool: ${toolId}`);
      }
      heavyTool = await loader();
      heavyToolCache.set(toolId, heavyTool);
    }

    const result = await heavyTool(params);
    logPerf(log, `dispatchTool:${toolId}`, startedAt, { path: "heavy" });
    return result;
  } catch (error) {
    log.error(`Tool execution failed: ${toolId}`, error);
    throw error;
  }
}

export async function dispatchTool(toolId: string, params: ToolParams): Promise<ToolResult> {
  const startedAt = nowMs();
  if (IS_RUNTIME_DEBUG) {
    log.info(`Dispatching tool: ${toolId}`, params);
  }

  if (toolId.startsWith("system.open") || toolId.startsWith("computer.") || toolId === "browser.navigate") {
    console.log("[LAUNCH TRACE]", "src/tools/dispatcher.ts", "dispatchTool", { toolId, params });
  }

  // Bypass trace wrapping for trace inspection tools to avoid recursive telemetry
  if (toolId === "system.traces" || toolId === "system.diagnostics") {
    return executeToolInternal(toolId, params, startedAt);
  }

  return tracer.trace(
    `tool:${toolId}`,
    "tool",
    () => executeToolInternal(toolId, params, startedAt),
    { toolId },
    params
  );
}
