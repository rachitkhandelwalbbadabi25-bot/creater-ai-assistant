import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { ToolError } from "@utils/errorHandler.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("tools/launcher");

function launchTrace(sourceFile: string, functionName: string, target: unknown): void {
  console.log("[LAUNCH TRACE]", sourceFile, functionName, target);
}

type LaunchKind = "url" | "file" | "directory" | "app";

export interface LaunchResult {
  success: true;
  kind: LaunchKind;
  receivedCommand: string;
  matchedApp?: string;
  resolvedPath: string;
  message: "Task completed";
}

interface AppDefinition {
  names: string[];
  command: string;
}

const WINDOWS_APPS: AppDefinition[] = [
  { names: ["notepad", "notes"], command: "notepad.exe" },
  { names: ["calculator", "calc"], command: "calc.exe" },
  { names: ["paint", "mspaint"], command: "mspaint.exe" },
  { names: ["explorer", "file explorer", "files"], command: "explorer.exe" },
  { names: ["cmd", "command prompt"], command: "cmd.exe" },
  { names: ["powershell"], command: "powershell.exe" },
  { names: ["edge", "microsoft edge"], command: "msedge.exe" },
  { names: ["chrome", "google chrome"], command: "chrome.exe" },
  { names: ["firefox"], command: "firefox.exe" },
  { names: ["vscode", "vs code", "visual studio code", "code"], command: "code.cmd" },
  { names: ["word", "microsoft word"], command: "winword.exe" },
  { names: ["excel", "microsoft excel"], command: "excel.exe" },
  { names: ["powerpoint", "microsoft powerpoint"], command: "powerpnt.exe" },
];

const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;
const INVALID_TARGETS = new Set(["", "\\", "\\\\", "/", "\"\"", "''"]);

function normalizeInput(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new ToolError("launcher.open", `${fieldName} must be a string`, { value });
  }

  const trimmed = value.trim();
  if (INVALID_TARGETS.has(trimmed)) {
    throw new ToolError("launcher.open", `Refusing to open empty or malformed target: ${JSON.stringify(trimmed)}`, {
      fieldName,
      target: trimmed,
    });
  }

  return trimmed;
}

function resolveExistingPath(target: string): { kind: "file" | "directory"; resolvedPath: string } | null {
  const expanded = target
    .replace(/^~(?=$|[\\/])/, process.env.USERPROFILE ?? process.env.HOME ?? "~")
    .replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? `%${name}%`);

  const resolvedPath = path.resolve(expanded);
  if (!existsSync(resolvedPath)) return null;

  const stat = statSync(resolvedPath);
  return {
    kind: stat.isDirectory() ? "directory" : "file",
    resolvedPath,
  };
}

function matchWindowsApp(command: string): { matchedApp: string; resolvedPath: string } | null {
  const normalized = command.toLowerCase().replace(/^open\s+/, "").trim();
  const app = WINDOWS_APPS.find((entry) => entry.names.includes(normalized));
  if (!app?.command || INVALID_TARGETS.has(app.command.trim())) {
    return null;
  }

  return {
    matchedApp: app.names[0]!,
    resolvedPath: app.command,
  };
}

async function runWindowsOpen(target: string, kind: LaunchKind): Promise<void> {
  launchTrace("src/tools/laptop/launcher.ts", "runWindowsOpen", target);
  const escapedTarget = target.replace(/'/g, "''");
  const script = kind === "file" || kind === "directory"
    ? `Invoke-Item -LiteralPath '${escapedTarget}'`
    : `Start-Process -FilePath '${escapedTarget}'`;

  const proc = Bun.spawn({
    cmd: [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script
    ],
    stdout: "pipe",
    stderr: "pipe",
    windowsHide: true,
  });

  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`Windows open failed with exit code ${exitCode}: ${stderr.trim() || stdout.trim() || "no stderr"}`);
  }
}

async function runCrossPlatformOpen(target: string, kind: LaunchKind): Promise<void> {
  launchTrace("src/tools/laptop/launcher.ts", "runCrossPlatformOpen", target);
  if (process.platform === "win32") {
    await runWindowsOpen(target, kind);
    return;
  }

  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  const proc = Bun.spawn({
    cmd: [cmd, target],
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  if (exitCode !== 0) {
    throw new Error(`${cmd} failed with exit code ${exitCode}: ${stderr.trim() || stdout.trim() || "no stderr"}`);
  }
}

export function resolveLaunchTarget(command: string): Omit<LaunchResult, "success" | "message"> {
  launchTrace("src/tools/laptop/launcher.ts", "resolveLaunchTarget", command);
  const receivedCommand = normalizeInput(command, "command");
  log.info("Received launch command", { receivedCommand });

  if (URL_PATTERN.test(receivedCommand)) {
    return {
      kind: "url",
      receivedCommand,
      resolvedPath: receivedCommand,
    };
  }

  const existingPath = resolveExistingPath(receivedCommand);
  if (existingPath) {
    return {
      kind: existingPath.kind,
      receivedCommand,
      resolvedPath: existingPath.resolvedPath,
    };
  }

  const appMatch = process.platform === "win32" ? matchWindowsApp(receivedCommand) : null;
  if (appMatch) {
    return {
      kind: "app",
      receivedCommand,
      matchedApp: appMatch.matchedApp,
      resolvedPath: appMatch.resolvedPath,
    };
  }

  throw new ToolError("launcher.open", `No valid app, URL, file, or directory matched: ${receivedCommand}`, {
    receivedCommand,
  });
}

export async function openLaunchTarget(command: string): Promise<LaunchResult> {
  launchTrace("src/tools/laptop/launcher.ts", "openLaunchTarget", command);
  const resolved = resolveLaunchTarget(command);
  log.info("Resolved launch target", resolved);

  try {
    await runCrossPlatformOpen(resolved.resolvedPath, resolved.kind);
    log.info("Opened successfully", resolved);
    return {
      success: true,
      ...resolved,
      message: "Task completed",
    };
  } catch (err) {
    log.error("Launch failed", err, resolved);
    throw new ToolError("launcher.open", err instanceof Error ? err.message : String(err), resolved);
  }
}

export async function openApp(appName: string): Promise<LaunchResult> {
  launchTrace("src/tools/laptop/launcher.ts", "openApp", appName);
  return openLaunchTarget(appName);
}

export async function openFileOrPath(targetPath: string): Promise<LaunchResult> {
  launchTrace("src/tools/laptop/launcher.ts", "openFileOrPath", targetPath);
  return openLaunchTarget(targetPath);
}

export async function openUrl(targetUrl: string): Promise<LaunchResult> {
  launchTrace("src/tools/laptop/launcher.ts", "openUrl", targetUrl);
  return openLaunchTarget(targetUrl);
}
