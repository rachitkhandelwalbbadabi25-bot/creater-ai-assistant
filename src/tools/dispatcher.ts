// ════════════════════════════════════════════════════════════════════════════════
// src/tools/dispatcher.ts — Maps tool IDs to their implementation functions
// ════════════════════════════════════════════════════════════════════════════════

import * as fsTools from "./laptop/fileSystem.js";
import * as shellTools from "./laptop/executor.js";
import * as systemTools from "./laptop/system.js";
import * as browserTools from "./laptop/browser.js";
import * as editorTools from "./laptop/editor.js";
import { ToolError } from "@utils/errorHandler.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("tools/dispatcher");

export async function dispatchTool(toolId: string, params: any): Promise<any> {
  log.info(`Dispatching tool: ${toolId}`, params);

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

      // ── Browser ──
      case "browser.navigate":
        try {
          return await browserTools.navigateToUrl(params.url);
        } catch (err) {
          log.warn(`Playwright failed for ${params.url}, falling back to OS shell`, { error: String(err) });
          const platform = process.platform;
          let cmd = "";
          if (platform === "win32") cmd = `start ${params.url}`;
          else if (platform === "darwin") cmd = `open ${params.url}`;
          else cmd = `xdg-open ${params.url}`;
          return await shellTools.executeCommand(cmd);
        }
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

      default:
        throw new ToolError(toolId, `No implementation found for tool: ${toolId}`);
    }
  } catch (error) {
    log.error(`Tool execution failed: ${toolId}`, error);
    throw error;
  }
}
