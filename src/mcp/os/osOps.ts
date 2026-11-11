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

/** Show system notifications using native Windows toast or node-notifier */
export async function notifications(title: string, message: string): Promise<boolean> {
  try {
    if (process.platform === 'win32') {
      try {
        const psCommand = `
          [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
          $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
          $textNodes = $template.GetElementsByTagName('text')
          $textNodes.Item(0).AppendChild($template.CreateTextNode('${title.replace(/'/g, "''")}')) | Out-Null
          $textNodes.Item(1).AppendChild($template.CreateTextNode('${message.replace(/'/g, "''")}')) | Out-Null
          $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe')
          $notification = [Windows.UI.Notifications.ToastNotification]::new($template)
          $notifier.Show($notification)
        `.trim().replace(/\n/g, '; ');

        const { exec } = await import('child_process');
        await new Promise<void>((resolve, reject) => {
          exec(`powershell -NoProfile -Command "${psCommand}"`, { windowsHide: true }, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        return true;
      } catch {
        // Fallback to node-notifier if PowerShell WinRT is restricted
        notifier.notify({ title, message, wait: false });
        return true;
      }
    } else {
      notifier.notify({ title, message, wait: false });
      return true;
    }
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
    // Primary engine: robust cross-platform screenshot-desktop
    try {
      const screenshotDesktop = (await import('screenshot-desktop')).default || (await import('screenshot-desktop'));
      await screenshotDesktop({ filename: filePath });
      if (fs.existsSync(filePath)) {
        return filePath;
      }
    } catch (sdErr) {
      // Fall through to OS native fallback
    }

    if (process.platform === 'win32') {
      const scriptPath = path.join(process.cwd(), 'src', 'tools', 'laptop', 'screenshot.ps1');
      if (fs.existsSync(scriptPath)) {
        execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -OutputPath "${filePath}"`, { stdio: 'ignore' });
      }
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
