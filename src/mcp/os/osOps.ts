// src/mcp/os/osOps.ts

import { spawn, execSync } from 'child_process';
import clipboardy from 'clipboardy';
import notifier from 'node-notifier';
import * as path from 'path';
import * as fs from 'fs';
import { OsMCPError } from './types.js';

const WHITELIST = ["ollama", "node", "powershell", "notifier"];

/** Spawns a whitelisted binary and returns its PID */
// TODO: In future replace Set<number> with Map<number, TrackedProcess> for richer metadata
const launchedPids = new Set<number>();

export async function openApp(name: string, args: string[] = []): Promise<number> {
  if (!WHITELIST.includes(name)) {
    throw new OsMCPError(`Binary '${name}' is not in the whitelist`, 'SECURITY_VIOLATION');
  }

  // Resolve executable name/path
  let execName = name;
  if (name === 'notifier') {
    // If notifier is requested, we can mock it or point to a harmless command
    execName = 'node';
    args = ['-e', 'console.log("notifier started")'];
  }

  try {
    const child = spawn(execName, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();

    if (!child.pid) {
      throw new Error('No PID returned from spawn');
    }

    // Verify process is still running after a short tick
    await new Promise((resolve) => setTimeout(resolve, 50));
    const isRunning = processExists(child.pid);
    if (!isRunning) {
      throw new Error('Process exited immediately after spawning');
    }

    launchedPids.add(child.pid!);
    return child.pid!;
  } catch (err: any) {
    throw new OsMCPError(`Failed to open app '${name}': ${err.message}`, 'SPAWN_FAILED');
  }
}

/** Access the system clipboard */
export async function clipboard(action: 'read' | 'write', text?: string): Promise<string> {
  try {
    if (action === 'write') {
      if (text === undefined) {
        throw new Error('Text is required for write action');
      }
      await clipboardy.write(text);
      return text;
    } else {
      return await clipboardy.read();
    }
  } catch (err: any) {
    throw new OsMCPError(`Clipboard operation failed: ${err.message}`, 'CLIPBOARD_FAILED');
  }
}

/** Show system notifications using node-notifier */
export async function notifications(title: string, message: string): Promise<boolean> {
  try {
    notifier.notify({
      title,
      message,
      wait: false,
    });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Capture a screenshot of the primary screen.
 * Saves the file as a PNG in process.cwd()/data/checkpoints/screenshots/ or temp dir,
 * returns the absolute path to the screenshot.
 */
export async function screenshot(): Promise<string> {
  const dir = path.join(process.cwd(), 'data', 'checkpoints', 'screenshots');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, `screenshot_${Date.now()}.png`);

  try {
    if (process.platform === 'win32') {
      const psCommand = `
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($screen.X, $screen.Y, 0, 0, $bmp.Size)
        $bmp.Save('${filePath.replace(/\\/g, '\\\\')}')
        $g.Dispose()
        $bmp.Dispose()
      `.trim().replace(/\n/g, '; ');

      execSync(`powershell -NoProfile -Command "${psCommand}"`, { stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      execSync(`screencapture "${filePath}"`, { stdio: 'ignore' });
    } else {
      throw new Error(`Platform '${process.platform}' is not supported for screenshots`);
    }

    if (!fs.existsSync(filePath)) {
      throw new Error('Screenshot file was not created');
    }

    return filePath;
  } catch (err: any) {
    throw new OsMCPError(`Screenshot failed: ${err.message}`, 'SCREENSHOT_FAILED');
  }
}

/** Checks the status of a process by PID */
export function processCheck(pid: number): { pid: number; status: 'running' | 'exited' } {
  const exists = processExists(pid);
  return {
    pid,
    status: exists ? 'running' : 'exited',
  };
}

/** Returns list of PIDs launched via openApp */
export function listLaunchedProcesses(): number[] {
  return Array.from(launchedPids);
}

/** Attempts to kill all launched processes (best effort) */
export function cleanupLaunchedProcesses(): void {
  // Ensure idempotent cleanup of tracked processes

  for (const pid of launchedPids) {
    try {
      process.kill(pid);
    } catch (_) {
      // ignore errors, process may have already exited
    }
  }
  launchedPids.clear();
}

/** Check if a PID is tracked */
export function isTrackedProcess(pid: number): boolean {
  return launchedPids.has(pid);
}


/** Helper to check if a process with a given PID exists */
function processExists(pid: number): boolean {
  try {
    // kill(pid, 0) checks if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e.code === 'EPERM'; // If permission denied, the process still exists
  }
}
