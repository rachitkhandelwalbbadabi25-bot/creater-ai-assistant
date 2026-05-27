import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { ToolError } from "@utils/errorHandler.js";
import { createLogger } from "@utils/logger.js";
import { createToolFailure, createToolSuccess, type ToolResult, withToolTimeout } from "@tools/toolResult.js";

const log = createLogger("tools/launcher");

function launchTrace(sourceFile: string, functionName: string, target: unknown): void {
  console.log("[LAUNCH TRACE]", sourceFile, functionName, target);
}

function safeLaunchLog(kind: "app" | "file", target: string): void {
  console.log("[SAFE LAUNCHER]", { kind, target });
  console.log("[SAFE GUI LAUNCH]", { kind, target });
  console.log("[LAUNCH TARGET]", target);
}

type LaunchKind = "file" | "directory" | "app";

export interface LaunchTarget {
  kind: LaunchKind;
  receivedCommand: string;
  matchedApp?: string;
  resolvedPath: string;
  verifyProcesses?: string[];
}

interface AppDefinition {
  names: string[];
  command: string;
  verifyProcesses?: string[];
}

const WINDOWS_APPS: AppDefinition[] = [
  { names: ["notepad", "notes"], command: "notepad.exe", verifyProcesses: ["notepad.exe"] },
  { names: ["calculator", "calc"], command: "calc.exe", verifyProcesses: ["calculatorapp.exe", "calc.exe"] },
  { names: ["paint", "mspaint"], command: "mspaint.exe", verifyProcesses: ["mspaint.exe"] },
  { names: ["explorer", "file explorer", "files"], command: "explorer.exe", verifyProcesses: ["explorer.exe"] },
  { names: ["cmd", "command prompt"], command: "cmd.exe", verifyProcesses: ["cmd.exe"] },
  { names: ["edge", "microsoft edge"], command: "msedge.exe", verifyProcesses: ["msedge.exe"] },
  { names: ["chrome", "google chrome"], command: "chrome.exe", verifyProcesses: ["chrome.exe"] },
  { names: ["firefox"], command: "firefox.exe", verifyProcesses: ["firefox.exe"] },
  { names: ["vscode", "vs code", "visual studio code", "code"], command: "code.cmd", verifyProcesses: ["code.exe"] },
  { names: ["word", "microsoft word"], command: "winword.exe", verifyProcesses: ["winword.exe"] },
  { names: ["excel", "microsoft excel"], command: "excel.exe", verifyProcesses: ["excel.exe"] },
  { names: ["powerpoint", "microsoft powerpoint"], command: "powerpnt.exe", verifyProcesses: ["powerpnt.exe"] },
];

const INVALID_TARGETS = new Set(["", "\\", "\\\\", "/", "\"\"", "''"]);
const LAUNCH_TIMEOUT_MS = 5000;
const VERIFY_TIMEOUT_MS = 3500;
const VERIFY_POLL_MS = 250;

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

function matchWindowsApp(command: string): { matchedApp: string; resolvedPath: string; verifyProcesses: string[] } | null {
  const normalized = command.toLowerCase().replace(/^open\s+/, "").trim();
  const app = WINDOWS_APPS.find((entry) => entry.names.includes(normalized));
  if (!app?.command || INVALID_TARGETS.has(app.command.trim())) {
    return null;
  }

  return {
    matchedApp: app.names[0]!,
    resolvedPath: app.command,
    verifyProcesses: app.verifyProcesses ?? [app.command],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function taskListContains(processName: string): Promise<boolean> {
  const proc = Bun.spawn({
    cmd: ["tasklist", "/FI", `IMAGENAME eq ${processName}`],
    stdout: "pipe",
    stderr: "ignore",
    windowsHide: true,
  });

  const output = (await new Response(proc.stdout).text()).toLowerCase();
  await proc.exited;
  return output.includes(processName.toLowerCase());
}

async function verifyProcessLaunch(processNames: string[]): Promise<{ verified: boolean; matchedProcess?: string }> {
  console.log("[EXECUTION VERIFICATION START]", { kind: "app", processNames });
  const deadline = Date.now() + VERIFY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    for (const processName of processNames) {
      if (await taskListContains(processName)) {
        console.log("[EXECUTION VERIFIED SUCCESS]", { kind: "app", processName });
        return { verified: true, matchedProcess: processName };
      }
    }
    await sleep(VERIFY_POLL_MS);
  }

  console.log("[EXECUTION VERIFICATION FAILED]", { kind: "app", processNames });
  return { verified: false };
}

function detachSpawn(cmd: string[], target: string) {
  console.log("[EXECUTION ATTEMPTED]", { cmd, target });
  const proc = Bun.spawn({
    cmd,
    stdout: "ignore",
    stderr: "ignore",
    windowsHide: true,
  });

  proc.unref?.();
  return proc;
}

async function waitForImmediateSpawnState(proc: ReturnType<typeof Bun.spawn>): Promise<number | null> {
  return await Promise.race<number | null>([
    proc.exited,
    sleep(400).then(() => null),
  ]);
}

async function spawnAppExecutable(executable: string): Promise<number | null> {
  launchTrace("src/tools/laptop/launcher.ts", "spawnAppExecutable", executable);
  const proc = detachSpawn([executable], executable);
  return await waitForImmediateSpawnState(proc);
}

async function openFileOrFolder(target: string, kind: "file" | "directory"): Promise<number | null> {
  launchTrace("src/tools/laptop/launcher.ts", "openFileOrFolder", target);
  if (process.platform === "win32") {
    const args = kind === "file" ? ["/select,", target] : [target];
    return await waitForImmediateSpawnState(detachSpawn(["explorer.exe", ...args], target));
  }

  const cmd = process.platform === "darwin" ? "open" : "xdg-open";
  return await waitForImmediateSpawnState(detachSpawn([cmd, target], target));
}

export function resolveLaunchTarget(command: string): LaunchTarget {
  launchTrace("src/tools/laptop/launcher.ts", "resolveLaunchTarget", command);
  const receivedCommand = normalizeInput(command, "command");
  log.info("Received launch command", { receivedCommand });

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
      verifyProcesses: appMatch.verifyProcesses,
    };
  }

  throw new ToolError("launcher.open", `No valid app, URL, file, or directory matched: ${receivedCommand}`, {
    receivedCommand,
  });
}

function humanizeTarget(target: string): string {
  const cleaned = target.replace(/\.exe$/i, "").replace(/\.cmd$/i, "").trim();
  if (!cleaned) return "item";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function toLaunchData(target: LaunchTarget): Record<string, unknown> {
  return {
    kind: target.kind,
    receivedCommand: target.receivedCommand,
    matchedApp: target.matchedApp,
    resolvedPath: target.resolvedPath,
    verifyProcesses: target.verifyProcesses,
  };
}

export async function openLaunchTarget(command: string, toolId = "system.open"): Promise<ToolResult> {
  const startedAt = Date.now();
  launchTrace("src/tools/laptop/launcher.ts", "openLaunchTarget", command);

  let resolved: LaunchTarget;
  try {
    resolved = resolveLaunchTarget(command);
    log.info("Resolved launch target", toLaunchData(resolved));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createToolFailure(toolId, startedAt, `I could not resolve ${command}.`, message, { command });
  }

  try {
    if (resolved.kind === "app") {
      safeLaunchLog("app", resolved.resolvedPath);
      console.log("[APP OPEN]", resolved.resolvedPath);
      const exitCode = await withToolTimeout(spawnAppExecutable(resolved.resolvedPath), LAUNCH_TIMEOUT_MS, toolId);
      if (typeof exitCode === "number" && exitCode !== 0) {
        return createToolFailure(
          toolId,
          startedAt,
          `I tried to open ${humanizeTarget(resolved.matchedApp ?? resolved.receivedCommand)}, but it exited immediately.`,
          `Process exited with code ${exitCode}`,
          toLaunchData(resolved)
        );
      }

      const verification = await withToolTimeout(
        verifyProcessLaunch(resolved.verifyProcesses ?? [resolved.resolvedPath]),
        VERIFY_TIMEOUT_MS + 1000,
        `${toolId}.verify`
      );

      if (!verification.verified) {
        return createToolFailure(
          toolId,
          startedAt,
          `I tried to open ${humanizeTarget(resolved.matchedApp ?? resolved.receivedCommand)}, but the launch could not be verified.`,
          "Process was not observed after launch.",
          toLaunchData(resolved)
        );
      }

      return createToolSuccess(
        toolId,
        startedAt,
        `${humanizeTarget(resolved.matchedApp ?? resolved.receivedCommand)} opened successfully.`,
        {
          verified: true,
          data: { ...toLaunchData(resolved), matchedProcess: verification.matchedProcess },
        }
      );
    }

    safeLaunchLog("file", resolved.resolvedPath);
    console.log("[FILE OPEN]", resolved.resolvedPath);
    const exitCode = await withToolTimeout(openFileOrFolder(resolved.resolvedPath, resolved.kind), LAUNCH_TIMEOUT_MS, toolId);
    const targetExists = existsSync(resolved.resolvedPath);

    if (typeof exitCode === "number" && exitCode !== 0) {
      return createToolFailure(
        toolId,
        startedAt,
        `I tried to open ${resolved.resolvedPath}, but Explorer reported an error.`,
        `Explorer exited with code ${exitCode}`,
        toLaunchData(resolved)
      );
    }

    console.log("[EXECUTION VERIFICATION START]", { kind: resolved.kind, target: resolved.resolvedPath });
    if (targetExists) {
      console.log("[EXECUTION VERIFIED SUCCESS]", { kind: resolved.kind, target: resolved.resolvedPath });
      return createToolSuccess(toolId, startedAt, "Opened file or folder.", {
        verified: true,
        data: toLaunchData(resolved),
      });
    }

    console.log("[EXECUTION VERIFICATION FAILED]", { kind: resolved.kind, target: resolved.resolvedPath });
    return createToolFailure(
      toolId,
      startedAt,
      `I tried to open ${resolved.resolvedPath}, but the target could not be verified afterward.`,
      "Target path no longer exists.",
      toLaunchData(resolved)
    );
  } catch (err) {
    log.error("Launch failed", err, toLaunchData(resolved));
    return createToolFailure(
      toolId,
      startedAt,
      `I tried to open ${humanizeTarget(resolved.matchedApp ?? resolved.receivedCommand)}, but it failed.`,
      err instanceof Error ? err.message : String(err),
      toLaunchData(resolved)
    );
  }
}

export async function openApp(appName: string): Promise<ToolResult> {
  launchTrace("src/tools/laptop/launcher.ts", "openApp", appName);
  return openLaunchTarget(appName, "system.open_app");
}

export async function openFileOrPath(targetPath: string): Promise<ToolResult> {
  launchTrace("src/tools/laptop/launcher.ts", "openFileOrPath", targetPath);
  return openLaunchTarget(targetPath, "system.open_path");
}

export async function openUrl(targetUrl: string): Promise<ToolResult> {
  console.log("[SHELL EXECUTION BLOCKED]", "src/tools/laptop/launcher.ts", "openUrl", targetUrl);
  return createToolFailure(
    "system.open_url",
    Date.now(),
    "URL launch is disabled in launcher. Use Playwright browser navigation.",
    "URL launch is disabled in launcher."
  );
}
