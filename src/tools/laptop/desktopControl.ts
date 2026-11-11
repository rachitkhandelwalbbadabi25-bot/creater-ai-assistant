// ════════════════════════════════════════════════════════════════════════════════
// src/tools/laptop/desktopControl.ts — Native Desktop Input & Window Controls (Phase 8)
// Provides OS-level mouse clicks, moves, keystrokes, and window management.
// ════════════════════════════════════════════════════════════════════════════════

import { execFile } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { promisify } from "util";
import { createLogger } from "@utils/logger.js";

const execFileAsync = promisify(execFile);
const log = createLogger("tools/desktopControl");

function getScriptPath(): string {
  const candidates = [
    path.resolve(__dirname, "desktopControl.ps1"),
    path.resolve(process.cwd(), "src/tools/laptop/desktopControl.ps1"),
    path.resolve(process.cwd(), "../../src/tools/laptop/desktopControl.ps1"),
    path.resolve(process.cwd(), "../src/tools/laptop/desktopControl.ps1"),
    path.resolve(__dirname, "../../../../src/tools/laptop/desktopControl.ps1"),
    "D:\\creater-ai-assistant\\src\\tools\\laptop\\desktopControl.ps1",
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch {}
  }
  return candidates[0];
}

export interface ActiveWindowInfo {
  success: boolean;
  hwnd?: number;
  title?: string;
  process?: string;
  pid?: number;
  openApps?: string[];
  bounds?: { x: number; y: number; width: number; height: number };
  error?: string;
}

export interface DesktopActionResult {
  success: boolean;
  action: string;
  x?: number;
  y?: number;
  button?: string;
  textLength?: number;
  key?: string;
  message?: string;
  error?: string;
}

async function runDesktopControl(args: string[]): Promise<any> {
  if (process.platform !== "win32") {
    // Linux/macOS mock fallback for cross-platform CI / dev environments
    log.info(`DesktopControl called on non-windows platform: ${args.join(" ")}`);
    return { success: true, simulated: true, action: args[1] || "unknown" };
  }

  const scriptPath = getScriptPath();

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args],
      { timeout: 10000, windowsHide: true }
    );
    const trimmed = stdout.trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(trimmed);
  } catch (error: any) {
    // Inline fallback for typing / keys if file invocation fails
    if (args[0] === "-Action" && args[1] === "type" && args[2] === "-Text") {
      const textToType = args[3] || "";
      try {
        const escaped = textToType.replace(/'/g, "''");
        await execFileAsync(
          "powershell.exe",
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('${escaped}')`,
          ],
          { windowsHide: true, timeout: 5000 }
        );
        return { success: true, action: "type", textLength: textToType.length };
      } catch (fbErr: any) {
        log.error("SendKeys fallback failed", { error: fbErr.message });
      }
    }
    log.error("DesktopControl execution failed", { args, error: error.message });
    return { success: false, error: error.message };
  }
}

/** Moves the mouse cursor to absolute desktop coordinates (x, y) */
export async function moveDesktopMouse(x: number, y: number): Promise<DesktopActionResult> {
  return runDesktopControl(["-Action", "move", "-X", String(Math.round(x)), "-Y", String(Math.round(y))]);
}

/** Clicks at absolute desktop coordinates (x, y) */
export async function clickDesktop(
  x: number,
  y: number,
  button: "left" | "right" | "middle" | "double" = "left"
): Promise<DesktopActionResult> {
  return runDesktopControl([
    "-Action",
    "click",
    "-X",
    String(Math.round(x)),
    "-Y",
    String(Math.round(y)),
    "-Button",
    button,
  ]);
}

/** Sends keystroke text to the active desktop window */
export async function typeDesktopText(text: string): Promise<DesktopActionResult> {
  return runDesktopControl(["-Action", "type", "-Text", text]);
}

/** Sends a special key (e.g. {ENTER}, {ESC}, {TAB}, ^c, ^v) */
export async function pressDesktopKey(key: string): Promise<DesktopActionResult> {
  return runDesktopControl(["-Action", "key", "-Key", key]);
}

/** Retrieves the currently focused foreground window */
export async function getActiveDesktopWindow(): Promise<ActiveWindowInfo> {
  return runDesktopControl(["-Action", "getactivewindow"]);
}

/** Focuses a window by title substring or PID */
export async function focusDesktopWindow(target: string | number): Promise<{ success: boolean; found: boolean; title?: string; pid?: number; message?: string }> {
  return runDesktopControl(["-Action", "focuswindow", "-TargetWindow", String(target)]);
}

