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

const log = createLogger("tools/dispatcher");

type ToolParams = Record<string, unknown>;
type ToolResult = unknown;
type ToolHandler = (params: ToolParams) => Promise<ToolResult>;

const FAST_TOOLS: Record<string, ToolHandler> = {
  "fs.read_file": (params) => fsTools.readFileContent(params.path as string, params.encoding as BufferEncoding | undefined),
  "fs.write_file": (params) => fsTools.writeFileContent(params.path as string, params.content as string, params.append as boolean | undefined),
  "fs.delete_file": (params) => fsTools.deleteFile(params.path as string),
  "fs.list_directory": (params) => fsTools.listDirectory(params.path as string, params.pattern as string | undefined),
  "shell.execute": (params) => shellTools.executeCommand(params.command as string, params.cwd as string | undefined, params.timeout_ms as number | undefined),
  "shell.execute_dangerous": (params) => shellTools.executeCommand(params.command as string),
  "system.info": () => systemTools.getSystemInfo(),
  "system.notify": async () => ({ success: true, message: "Notification sent (mock)" }),
  "system.open_app": (params) => launcherTools.openApp(params.app as string),
  "system.open_path": (params) => launcherTools.openFileOrPath(params.path as string),
  "browser.navigate": (params) => launcherTools.openUrl(params.url as string),
  "editor.open_file": (params) => editorTools.openInVSCode(params.path as string, params.line as number | undefined),
  "git.status": (params) => editorTools.gitStatus(params.repo_path as string),
  "git.commit": (params) => editorTools.gitCommit(params.repo_path as string, params.message as string),
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
    return (params) => computerTools.playYouTube(params.query as string);
  },
  "computer.close_browser": async () => {
    const computerTools = await import("./laptop/computer.js");
    return () => computerTools.closeBrowserWindow();
  },
};

const heavyToolCache = new Map<string, ToolHandler>();

export async function dispatchTool(toolId: string, params: ToolParams): Promise<ToolResult> {
  const startedAt = nowMs();
  if (IS_RUNTIME_DEBUG) {
    log.info(`Dispatching tool: ${toolId}`, params);
  }

  if (toolId.startsWith("system.open") || toolId.startsWith("computer.") || toolId === "browser.navigate") {
    console.log("[LAUNCH TRACE]", "src/tools/dispatcher.ts", "dispatchTool", { toolId, params });
  }

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
