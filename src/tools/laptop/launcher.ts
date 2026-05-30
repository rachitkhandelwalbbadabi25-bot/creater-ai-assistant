// Updated src/tools/laptop/launcher.ts – deterministic validation and messages
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { ToolError } from "@utils/errorHandler.js";
import { createLogger } from "@utils/logger.js";
import fs from "node:fs";

const log = createLogger("tools/launcher");

function launchTrace(sourceFile: string, functionName: string, target: unknown): void {
  console.log("[LAUNCH TRACE]", sourceFile, functionName, target);
}

type LaunchKind = "url" | "file" | "directory" | "app" | "screenshot";

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

  const escapedTarget = target.replace(/["`$]/g, (m) => "`" + m);
  const command = kind === "file" || kind === "directory"
    ? `Invoke-Item -LiteralPath "${escapedTarget}"`
    : `Start-Process "${escapedTarget}"`;

  let proc;
  try {
    proc = Bun.spawn({
      cmd: [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
      ],
      stdout: "pipe",
      stderr: "pipe",
      windowsHide: true,
    });
  } catch (spawnError) {
    throw spawnError;
  }

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
  log.info("FILESYSTEM RESOLVER ACTIVE");
  const receivedCommand = normalizeInput(command, "command");
  log.info("Received launch command", { receivedCommand });

  // Screenshot request
  if (/screenshot/i.test(receivedCommand)) {
    log.info("SCREENSHOT CAPTURE START");
    return { kind: "screenshot", receivedCommand, resolvedPath: "" };
  }

  // URL handling
  if (URL_PATTERN.test(receivedCommand)) {
    return {
      kind: "url",
      receivedCommand,
      resolvedPath: receivedCommand,
    };
  }

  // Folder resolution
  const folderPath = resolveFolderPath(receivedCommand);
  if (folderPath) {
    if (!existsSync(folderPath)) {
      throw new ToolError("launcher.open", "Folder not found.", { folderPath });
    }
    log.info("FILESYSTEM MATCH FOUND", { folderPath });
    return { kind: "directory", receivedCommand, resolvedPath: folderPath };
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
  if (!appMatch && !existingPath) {
    // Second fuzzy folder attempt
    const fuzzyPath = resolveFolderPath(receivedCommand);
    if (fuzzyPath) {
      if (!existsSync(fuzzyPath)) {
        throw new ToolError("launcher.open", "Folder not found.", { fuzzyPath });
      }
      log.info("FILESYSTEM MATCH FOUND (fuzzy)", { fuzzyPath });
      return { kind: "directory", receivedCommand, resolvedPath: fuzzyPath };
    }
  }

  if (appMatch) {
    return {
      kind: "app",
      receivedCommand,
      matchedApp: appMatch.matchedApp,
      resolvedPath: appMatch.resolvedPath,
    };
  }

  throw new ToolError("launcher.open", `No valid app, URL, file, directory, or screenshot matched: ${receivedCommand}`, {
    receivedCommand,
  });
}

export async function openLaunchTarget(command: string): Promise<LaunchResult> {
  launchTrace("src/tools/laptop/launcher.ts", "openLaunchTarget", command);
  const resolved = resolveLaunchTarget(command);
  log.info("Resolved launch target", resolved);

  try {
    if (resolved.kind === "screenshot") {
      const screenshotPath = await runNativeScreenshot();
      // Verify screenshot file exists
      if (!existsSync(screenshotPath)) {
        throw new ToolError("launcher.open", "Screenshot file not created", resolved);
      }
      return { success: true, kind: "screenshot", receivedCommand: resolved.receivedCommand, resolvedPath: screenshotPath, message: "Screenshot captured successfully." };
    }

    // For other kinds, attempt to open and then verify existence where applicable
    await runCrossPlatformOpen(resolved.resolvedPath, resolved.kind);

    // Post‑open verification
    if (resolved.kind === "directory" && !existsSync(resolved.resolvedPath)) {
      throw new ToolError("launcher.open", "Folder not found", resolved);
    }
    if (resolved.kind === "file" && !existsSync(resolved.resolvedPath)) {
      throw new ToolError("launcher.open", "File not found", resolved);
    }
    // For apps and URLs we assume success if the command did not error
    return { ...resolved, success: true, message: "Task completed" };
  } catch (err) {
    log.error("Launch failed", err, resolved);
    // Propagate as ToolError with appropriate message
    if (err instanceof ToolError) {
      throw err;
    }
    throw new ToolError("launcher.open", err instanceof Error ? err.message : String(err), resolved);
  }
}

/** Resolve common folder names to actual filesystem paths */
function resolveFolderPath(query: string): string | null {
  const clean = query.toLowerCase().replace(/^open\s+/i, "").trim();
  const basePaths = {
    desktop: path.join(process.env.USERPROFILE ?? "", "Desktop"),
    documents: path.join(process.env.USERPROFILE ?? "", "Documents"),
    downloads: path.join(process.env.USERPROFILE ?? "", "Downloads"),
    workspace: process.cwd(),
  } as const;

  for (const [key, base] of Object.entries(basePaths)) {
    if (clean.includes(key)) {
      log.info("FILESYSTEM SEARCH START", { key, base });
      if (existsSync(base)) {
        log.info("FILESYSTEM PATH VERIFIED", { base });
        return base;
      }
    }
  }

  if (clean.endsWith("folder")) {
    const possible = clean.replace(/\s+folder$/i, "").trim().split(/\s+/).pop();
    if (possible) {
      const entries = fs.readdirSync(process.cwd(), { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.toLowerCase() === possible) {
          const candidate = path.join(process.cwd(), entry.name);
          log.info("FILESYSTEM MATCH FOUND (explicit folder)", { candidate });
          return candidate;
        }
      }
    }
  }

  try {
    const entries = fs.readdirSync(process.cwd(), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && clean.includes(entry.name.toLowerCase())) {
        const candidate = path.join(process.cwd(), entry.name);
        log.info("FILESYSTEM MATCH FOUND (fuzzy)", { candidate });
        return candidate;
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
}

/** Run a native Windows screenshot using PowerShell */
async function runNativeScreenshot(): Promise<string> {
  const script = `Add-Type -AssemblyName System.Drawing; $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $bitmap = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height; $graphics = [System.Drawing.Graphics]::FromImage($bitmap); $graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size); $filename = "screenshot_${Date.now()}.png"; $bitmap.Save($filename, [System.Drawing.Imaging.ImageFormat]::Png); Write-Output $filename`;
  const proc = Bun.spawn({
    cmd: ["powershell.exe", "-NoProfile", "-Command", script],
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
    log.error("SCREENSHOT CAPTURE FAILED", { stderr, stdout });
    throw new Error(`Screenshot failed: ${stderr || stdout}`);
  }
  const filePath = stdout.trim();
  log.info("SCREENSHOT SAVE COMPLETE", { filePath });
  return filePath;
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
