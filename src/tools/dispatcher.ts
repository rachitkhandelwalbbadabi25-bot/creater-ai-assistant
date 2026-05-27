// ════════════════════════════════════════════════════════════════════════════════
// src/tools/dispatcher.ts — Maps tool IDs to their implementation functions
// ════════════════════════════════════════════════════════════════════════════════

import * as fsTools from "./laptop/fileSystem.js";
import * as browserTools from "@tools/laptop/browser.js";
import * as editorTools from "./laptop/editor.js";
import * as computerTools from "./laptop/computer.js";
import * as launcherTools from "./laptop/launcher.js";
import { ToolError } from "@utils/errorHandler.js";
import { createLogger } from "@utils/logger.js";
import { createToolFailure, normalizeToolResult, type ToolResult } from "@tools/toolResult.js";

const log = createLogger("tools/dispatcher");
console.log("[MODULE LOAD]", import.meta.url);

export async function dispatchTool(toolId: string, params: any): Promise<ToolResult> {
  const startedAt = Date.now();
  log.info(`Dispatching tool: ${toolId}`, params);
  if (toolId.startsWith("system.open") || toolId.startsWith("computer.") || toolId === "browser.navigate") {
    console.log("[LAUNCH TRACE]", "src/tools/dispatcher.ts", "dispatchTool", { toolId, params });
  }

  try {
    switch (toolId) {
      // ── File System ──
      case "fs.read_file":
        return normalizeToolResult(toolId, startedAt, await fsTools.readFileContent(params.path, params.encoding), "File read.");
      case "fs.write_file":
        return normalizeToolResult(toolId, startedAt, await fsTools.writeFileContent(params.path, params.content, params.append), "File written.");
      case "fs.delete_file":
        return normalizeToolResult(toolId, startedAt, await fsTools.deleteFile(params.path), "File deleted.");
      case "fs.list_directory":
        return normalizeToolResult(toolId, startedAt, await fsTools.listDirectory(params.path, params.pattern), "Directory listed.");

      // ── Shell ──
      case "shell.execute":
        console.log("[SHELL EXECUTION BLOCKED]", "src/tools/dispatcher.ts", "shell.execute", params?.command);
        return createToolFailure(toolId, startedAt, "Shell execution is disabled during stabilization.", "Shell execution disabled during stabilization");
      case "shell.execute_dangerous":
        console.log("[SHELL EXECUTION BLOCKED]", "src/tools/dispatcher.ts", "shell.execute_dangerous", params?.command);
        return createToolFailure(toolId, startedAt, "Shell execution is disabled during stabilization.", "Shell execution disabled during stabilization");

      // ── System ──
      case "system.info":
        return normalizeToolResult(toolId, startedAt, await import("./laptop/system.js").then((m) => m.getSystemInfo()), "System info retrieved.");
      case "system.notify":
        // TODO: Implement notification tool
        return normalizeToolResult(toolId, startedAt, { success: true, message: "Notification sent (mock)" }, "Notification sent.");
      case "system.open_app":
        return await launcherTools.openApp(params.app);
      case "system.open_path":
        return await launcherTools.openFileOrPath(params.path);

      // ── Browser ──
      case "browser.navigate":
        console.log("[PLAYWRIGHT PATH]", "src/tools/dispatcher.ts", "browser.navigate", params?.url);
        console.log("[BROWSER NAVIGATION]", params?.url);
        return await browserTools.navigateToUrl(params.url);
      case "browser.extract_text":
        return await browserTools.extractText(params.url);
      case "browser.screenshot":
        return await browserTools.takeScreenshot(params.url, params.savePath || `./screenshot_${Date.now()}.png`);

      // ── Editor / Git ──
      case "editor.open_file":
        return normalizeToolResult(toolId, startedAt, await editorTools.openInVSCode(params.path, params.line), "Editor opened.");
      case "git.status":
        return normalizeToolResult(toolId, startedAt, await editorTools.gitStatus(params.repo_path), "Git status retrieved.");
      case "git.commit":
        return normalizeToolResult(toolId, startedAt, await editorTools.gitCommit(params.repo_path, params.message), "Git commit created.");

      // ── Computer Control ──
      case "computer.navigate":
        return normalizeToolResult(toolId, startedAt, await computerTools.navigateTo(params.url), "Navigation completed.");
      case "computer.click":
        return normalizeToolResult(toolId, startedAt, await computerTools.clickAt(params.x, params.y), "Click completed.");
      case "computer.click_selector":
        return normalizeToolResult(toolId, startedAt, await computerTools.clickSelector(params.selector), "Click completed.");
      case "computer.type":
        return normalizeToolResult(toolId, startedAt, await computerTools.typeText(params.text, params.selector), "Typing completed.");
      case "computer.press_key":
        return normalizeToolResult(toolId, startedAt, await computerTools.pressKey(params.key), "Key press completed.");
      case "computer.shortcut":
        return normalizeToolResult(toolId, startedAt, await computerTools.keyboardShortcut(params.shortcut), "Shortcut completed.");
      case "computer.scroll":
        return normalizeToolResult(toolId, startedAt, await computerTools.scrollPage(params.direction, params.amount), "Scroll completed.");
      case "computer.screenshot":
        return normalizeToolResult(toolId, startedAt, await computerTools.takeScreenshotOfPage(), "Screenshot completed.");
      case "computer.get_text":
        return normalizeToolResult(toolId, startedAt, await computerTools.getPageText(), "Page text retrieved.");
      case "computer.fill_form":
        return normalizeToolResult(toolId, startedAt, await computerTools.fillForm(params.selector, params.value), "Form filled.");
      case "computer.close_browser":
        return normalizeToolResult(toolId, startedAt, await computerTools.closeBrowserWindow(), "Browser closed.");

      default:
        throw new ToolError(toolId, `No implementation found for tool: ${toolId}`);
    }
  } catch (error) {
    log.error(`Tool execution failed: ${toolId}`, error);
    return createToolFailure(
      toolId,
      startedAt,
      `I tried to run ${toolId}, but it failed.`,
      error instanceof Error ? error.message : String(error)
    );
  }
}
