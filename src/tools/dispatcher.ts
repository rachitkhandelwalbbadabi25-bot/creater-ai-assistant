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
        return await launcherTools.openApp(params.app);
      case "system.open_path":
        return await launcherTools.openFileOrPath(params.path);

      // ── Browser ──
        case "browser.navigate":
          // FAST URL NAVIGATION DETECTED – bypass Playwright for simple navigation
          log.info("PLAYWRIGHT BYPASS ACTIVE", { url: params.url });
          const result = await launcherTools.openUrl(params.url);
          log.info("DIRECT URL LAUNCH EXECUTED", { url: params.url, result });
          return result;
      case "browser.extract_text":
        return await browserTools.extractText(params.url);
      case "browser.screenshot":
        return await browserTools.takeScreenshot(params.url, params.savePath || `./screenshot_${Date.now()}.png`);

      // ── Editor / Git ──
      case "editor.open_file":
        return await editorTools.openInVSCode(params.path, params.line);
      case "git.status":
        return await editorTools.gitStatus(params.repo_path);
      case "git.commit":
        return await editorTools.gitCommit(params.repo_path, params.message);

      // ── Computer Control ──
      case "computer.open_browser":
        return await computerTools.openBrowser(params.url);
      case "computer.navigate":
        return await computerTools.navigateTo(params.url);
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
      case "computer.play_youtube":
        return await computerTools.playYouTube(params.query);
      case "computer.close_browser":
        return await computerTools.closeBrowserWindow();

      default:
        throw new ToolError(toolId, `No implementation found for tool: ${toolId}`);
    }
  } catch (error) {
    log.error(`Tool execution failed: ${toolId}`, error);
    throw error;
  }
}
