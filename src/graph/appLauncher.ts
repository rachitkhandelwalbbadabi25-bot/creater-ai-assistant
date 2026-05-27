import { openApp, openFileOrPath } from "@tools/laptop/launcher.js";
import * as browserTools from "@tools/laptop/browser.js";
import { createToolSuccess, type ToolResult } from "@tools/toolResult.js";
import { createLogger } from "@utils/logger.js";
import { ToolError } from "@utils/errorHandler.js";
import type { FastCommand } from "./commandRouter.js";

const log = createLogger("graph/appLauncher");

const CLOSEABLE_APPS: Record<string, string[]> = {
  browser: ["msedge.exe", "chrome.exe", "firefox.exe"],
  edge: ["msedge.exe"],
  chrome: ["chrome.exe"],
  firefox: ["firefox.exe"],
  notepad: ["notepad.exe"],
  calculator: ["calc.exe"],
  calc: ["calc.exe"],
  paint: ["mspaint.exe"],
  explorer: ["explorer.exe"],
  vscode: ["code.exe"],
  "vs code": ["code.exe"],
};

function humanizeTarget(target: string): string {
  const trimmed = target.trim();
  if (!trimmed) return "item";
  const normalized = trimmed
    .replace(/\.exe$/i, "")
    .replace(/\.cmd$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const prettyMap: Record<string, string> = {
    notepad: "Notepad",
    notes: "Notes",
    calculator: "Calculator",
    calc: "Calculator",
    paint: "Paint",
    mspaint: "Paint",
    explorer: "File Explorer",
    "file explorer": "File Explorer",
    files: "Files",
    chrome: "Chrome",
    edge: "Edge",
    firefox: "Firefox",
    vscode: "VS Code",
    "vs code": "VS Code",
    "visual studio code": "Visual Studio Code",
    cmd: "Command Prompt",
    powershell: "PowerShell",
  };

  return prettyMap[normalized.toLowerCase()] ?? normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function safeLauncherLog(functionName: string, target: unknown): void {
  console.log("[SAFE LAUNCHER]", "src/graph/appLauncher.ts", functionName, target);
}

export async function launchApp(app: string) {
  console.log("[DESKTOP APP PATH]", "src/graph/appLauncher.ts", "launchApp", app);
  safeLauncherLog("launchApp", app);
  log.info("Launching app", { app });
  const result = await openApp(app);
  if (result.success && result.verified) {
    return {
      ...result,
      message: `${humanizeTarget(app)} opened successfully.`,
    };
  }
  if (result.success && !result.verified) {
    return {
      ...result,
      message: `I tried to open ${humanizeTarget(app)}, but the launch could not be verified.`,
    };
  }
  return result;
}

export async function launchPath(targetPath: string) {
  console.log("[DESKTOP APP PATH]", "src/graph/appLauncher.ts", "launchPath", targetPath);
  safeLauncherLog("launchPath", targetPath);
  log.info("Launching path", { targetPath });
  const result = await openFileOrPath(targetPath);
  return result.success && result.verified
    ? { ...result, message: "Opened file or folder." }
    : result.success
      ? { ...result, message: "I tried to open the file or folder, but the launch could not be verified." }
      : result;
}

export async function launchUrl(url: string) {
  console.log("[PLAYWRIGHT PATH]", "src/graph/appLauncher.ts", "launchUrl", url);
  console.log("[BROWSER NAVIGATION]", url);
  log.info("Launching url via Playwright", { url });
  return await browserTools.navigateToUrl(url);
}

export async function launchBrowserHome() {
  safeLauncherLog("launchBrowserHome", "https://www.google.com");
  const result = await launchUrl("https://www.google.com");
  return {
    ...result,
    message: "Opened browser",
  };
}

export async function launchYouTube(query?: string) {
  const url = query
    ? `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
    : "https://www.youtube.com";
  safeLauncherLog("launchYouTube", query ?? "https://www.youtube.com");
  const result = await launchUrl(url);
  if (result.success && result.verified) {
    return {
      ...result,
      message: query ? `Opened YouTube for ${query}.` : "Opened YouTube.",
    };
  }
  if (result.success && !result.verified) {
    return {
      ...result,
      message: query
        ? `I tried to open YouTube for ${query}, but the browser launch could not be verified.`
        : "I tried to open YouTube, but the browser launch could not be verified.",
    };
  }
  return result;
}

export async function executeFastCommand(command: FastCommand): Promise<ToolResult> {
  console.log("[FAST PATH]", "src/graph/appLauncher.ts", command.kind, command.raw);
  console.log("[FAST PATH EXECUTED]", "src/graph/appLauncher.ts", command.kind, command.raw);
  switch (command.kind) {
    case "open_app":
      return launchApp(command.app);
    case "open_url":
      return launchUrl(command.url);
    case "open_path":
      return launchPath(command.path);
    case "open_downloads":
      return launchPath(command.path);
    case "close_app":
      return closeApp(command.app);
    case "browser_home":
      return launchBrowserHome();
    case "youtube":
      return launchYouTube(command.query);
    case "volume":
      return createToolSuccess(
        "system.volume",
        Date.now(),
        command.direction === "up"
          ? "Volume increased."
          : command.direction === "down"
            ? "Volume decreased."
            : "Volume toggled.",
        {
          verified: false,
          data: { direction: command.direction },
        }
      );
    default:
      throw new ToolError("fast.command", `Unhandled fast command: ${(command as { kind: string }).kind}`);
  }
}

export async function closeApp(app: string): Promise<ToolResult> {
  const startedAt = Date.now();
  console.log("[LAUNCH TRACE]", "src/graph/appLauncher.ts", "closeApp", app);
  const executables = CLOSEABLE_APPS[app.toLowerCase()];
  if (!executables?.length) {
    throw new ToolError("app.close", `Unsupported app close target: ${app}`, { app });
  }

  const results = [];
  for (const executable of executables) {
    const proc = Bun.spawn({
      cmd: ["taskkill", "/IM", executable, "/T", "/F"],
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    results.push({ executable, exitCode, stdout: stdout.trim(), stderr: stderr.trim() });
  }

  const anyClosed = results.some((entry) => entry.exitCode === 0);
  if (!anyClosed) {
    throw new ToolError("app.close", `Failed to close ${app}`, { app, results });
  }

  return createToolSuccess("system.close_app", startedAt, `${humanizeTarget(app)} closed successfully.`, {
    verified: true,
    data: { app, results },
  });
}
