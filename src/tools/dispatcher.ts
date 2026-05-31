// ════════════════════════════════════════════════════════════════════════════════
// src/tools/dispatcher.ts — Maps tool IDs to their implementation functions
// ════════════════════════════════════════════════════════════════════════════════

import * as fsTools from "./laptop/fileSystem.js";
import * as shellTools from "./laptop/executor.js";
import * as systemTools from "./laptop/system.js";
import * as browserTools from "./laptop/browser.js";
import * as editorTools from "./laptop/editor.js";
import * as computerTools from "./laptop/computer.js";
import * as launcherTools from "./laptop/launcher.js";
import { ToolError } from "@utils/errorHandler.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("tools/dispatcher");

export async function dispatchTool(toolId: string, params: any): Promise<any> {
  log.info(`Dispatching tool: ${toolId}`, params);
  if (toolId.startsWith("system.open") || toolId.startsWith("computer.") || toolId === "browser.navigate") {
    console.log("[LAUNCH TRACE]", "src/tools/dispatcher.ts", "dispatchTool", { toolId, params });
  }

  try {
    switch (toolId) {
      // ── File System ──
      case "fs.read_file":
        return await fsTools.readFileContent(params.path, params.encoding);
      case "fs.write_file":
        return await fsTools.writeFileContent(params.path, params.content, params.append);
      case "fs.delete_file":
        return await fsTools.deleteFile(params.path);
      case "fs.list_directory":
        return await fsTools.listDirectory(params.path, params.pattern);

      // ── Shell ──
      case "shell.execute":
        return await shellTools.executeCommand(params.command, params.cwd, params.timeout_ms);
      case "shell.execute_dangerous":
        return await shellTools.executeCommand(params.command);

      // ── System ──
      case "system.info":
        return await systemTools.getSystemInfo();
      case "system.notify":
        // TODO: Implement notification tool
        return { success: true, message: "Notification sent (mock)" };
      case "system.open_app":
        const appRes = await launcherTools.openApp(params.app);
        if (params.app.toLowerCase().includes("chrome") && params.__state?.browserState) {
          params.__state.browserState.isLaunched = true;
          params.__state.browserState.activeContext = true;
        }
        return appRes;
      case "system.open_path":
        return await launcherTools.openFileOrPath(params.path);

      // ── Browser ──
      case "browser.navigate":
        // Use ONE deterministic execution strategy via launcher (native Chrome)
        const url = params.url;
        const navRes = await launcherTools.openUrl(url);
        // Track browser context deterministically
        if (params.__state?.browserState) {
          params.__state.browserState.isLaunched = true;
          params.__state.browserState.activeContext = true;
          params.__state.browserState.currentUrl = url;
        }
        return navRes;
      case "browser.extract_text":
        return await browserTools.extractText(params.url);
      case "browser.screenshot":
        // Map to native screenshot for deterministic execution without active browser requirement
        return await computerTools.takeScreenshotOfPage();

      // ── Editor / Git ──
      case "editor.open_file":
        return await editorTools.openInVSCode(params.path, params.line);
      case "git.status":
        return await editorTools.gitStatus(params.repo_path);
      case "git.commit":
        return await editorTools.gitCommit(params.repo_path, params.message);

      // ── Computer Control ──
      case "computer.open_browser": {
        const res = await computerTools.openBrowser(params.url);
        if (params.__state?.browserState) {
          params.__state.browserState.isLaunched = true;
          params.__state.browserState.activeContext = true;
          params.__state.browserState.currentUrl = params.url || "https://www.google.com";
        }
        return res;
      }
      case "computer.navigate": {
        const res = await computerTools.navigateTo(params.url);
        if (params.__state?.browserState) {
          params.__state.browserState.isLaunched = true;
          params.__state.browserState.activeContext = true;
          params.__state.browserState.currentUrl = params.url;
        }
        return res;
      }
      case "computer.click":
        return await computerTools.clickAt(params.x, params.y);
      case "computer.click_selector":
        return await computerTools.clickSelector(params.selector);
      case "computer.type":
        return await computerTools.typeText(params.text, params.selector);
      case "computer.press_key":
        return await computerTools.pressKey(params.key);
      case "computer.shortcut":
        return await computerTools.keyboardShortcut(params.shortcut);
      case "computer.scroll":
        return await computerTools.scrollPage(params.direction, params.amount);
      case "computer.screenshot":
        return await computerTools.takeScreenshotOfPage();
      case "computer.get_text":
        return await computerTools.getPageText();
      case "computer.fill_form":
        return await computerTools.fillForm(params.selector, params.value);
      case "computer.play_youtube": {
        const res = await computerTools.playYouTube(params.query);
        if (params.__state?.browserState) {
          params.__state.browserState.isLaunched = true;
          params.__state.browserState.activeContext = true;
          params.__state.browserState.currentUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(params.query)}`;
        }
        return res;
      }
      case "computer.close_browser": {
        const res = await computerTools.closeBrowserWindow();
        if (params.__state?.browserState) {
          params.__state.browserState.activeContext = false;
        }
        return res;
      }

      default:
        throw new ToolError(toolId, `No implementation found for tool: ${toolId}`);
    }
  } catch (error) {
    log.error(`Tool execution failed: ${toolId}`, error);
    throw error;
  }
}
