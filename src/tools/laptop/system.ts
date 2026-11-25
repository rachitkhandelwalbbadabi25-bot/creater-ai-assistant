// ════════════════════════════════════════════════════════════════════════════════
// src/tools/laptop/system.ts — System info, processes, environment, clipboard
// ════════════════════════════════════════════════════════════════════════════════

import { createLogger } from "@utils/logger.js";
import { formatBytes } from "@utils/helpers.js";
import { clipboard as osClipboard } from "../../mcp/os/osOps.js";
import { SafetyError, ToolError } from "@utils/errorHandler.js";

const log = createLogger("tools/system");

export interface SystemSnapshot {
  cpu: { model: string; usage: number; cores: number; temp?: number };
  ram: { total: string; used: string; usagePercent: number };
  battery: { percent: number; charging: boolean; timeRemaining: string } | null;
  disk: Array<{ mount: string; total: string; used: string; usagePercent: number }>;
  uptime: string;
  os: string;
}

let cachedStaticSpecs: { cpuModel: string; cores: number; os: string } | null = null;
let cachedSnapshot: SystemSnapshot = {
  cpu: { model: "Loading...", usage: 0, cores: 1 },
  ram: { total: "0 GB", used: "0 GB", usagePercent: 0 },
  battery: null,
  disk: [],
  uptime: "0h 0m",
  os: "Loading..."
};
let isUpdating = false;

async function updateMetricsInBackground() {
  if (isUpdating) return;
  isUpdating = true;
  try {
    const si = (await import("systeminformation")).default;

    if (!cachedStaticSpecs) {
      const [cpu, osInfo] = await Promise.all([
        si.cpu(),
        si.osInfo(),
      ]);
      cachedStaticSpecs = {
        cpuModel: `${cpu.manufacturer} ${cpu.brand}`,
        cores: cpu.cores,
        os: `${osInfo.distro} ${osInfo.release}`,
      };
    }

    const [cpuLoad, mem, battery, disk, time] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.battery(),
      si.fsSize(),
      si.time(),
    ]);

    const cpuTemp = await si.cpuTemperature().catch(() => ({ main: undefined }));

    cachedSnapshot = {
      cpu: {
        model: cachedStaticSpecs.cpuModel,
        usage: Math.round(cpuLoad.currentLoad),
        cores: cachedStaticSpecs.cores,
        temp: cpuTemp.main ?? undefined,
      },
      ram: {
        total: formatBytes(mem.total),
        used: formatBytes(mem.used),
        usagePercent: Math.round((mem.used / mem.total) * 100),
      },
      battery: battery.hasBattery ? {
        percent: battery.percent,
        charging: battery.isCharging,
        timeRemaining: battery.timeRemaining > 0 ? `${Math.round(battery.timeRemaining / 60)}h ${Math.round(battery.timeRemaining % 60)}m` : "calculating",
      } : null,
      disk: disk.slice(0, 3).map(d => ({
        mount: d.mount,
        total: formatBytes(d.size),
        used: formatBytes(d.used),
        usagePercent: Math.round(d.use),
      })),
      uptime: `${Math.floor(time.uptime / 3600)}h ${Math.floor((time.uptime % 3600) / 60)}m`,
      os: cachedStaticSpecs.os,
    };
  } catch (error) {
    log.error("Failed to update system metrics in background", error);
  } finally {
    isUpdating = false;
  }
}

let metricsTimer: ReturnType<typeof setInterval> | null = null;

function ensureMetricsLoopStarted(): void {
  if (!metricsTimer) {
    metricsTimer = setInterval(updateMetricsInBackground, 30000);
    if (typeof metricsTimer.unref === "function") {
      metricsTimer.unref();
    }
    void updateMetricsInBackground();
  }
}

export async function getSystemInfo(): Promise<SystemSnapshot> {
  ensureMetricsLoopStarted();
  return cachedSnapshot;
}

export async function getProcesses(topN = 10): Promise<Array<{ name: string; cpu: number; mem: number; pid: number }>> {
  if (process.platform === "win32") {
    try {
      const proc = Bun.spawn(["tasklist", "/FO", "CSV", "/NH"], {
        stdout: "pipe",
        stderr: "pipe",
        windowsHide: true,
      });
      const timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
      }, 4000);
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      clearTimeout(timer);

      const parsed: Array<{ name: string; cpu: number; mem: number; pid: number }> = [];
      for (const line of stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('"')) continue;
        // Format: "Image Name","PID","Session Name","Session#","Mem Usage"
        const cols = trimmed.slice(1, -1).split('","');
        if (cols.length < 5) continue;
        const name = cols[0] || "";
        const pid = parseInt(cols[1] || "0", 10);
        const memKb = parseInt((cols[4] || "0").replace(/[^0-9]/g, ""), 10);
        if (!Number.isNaN(pid) && pid > 0) {
          parsed.push({
            name,
            cpu: 0,
            mem: Math.round((memKb / 1024) * 10) / 10,
            pid,
          });
        }
      }
      if (parsed.length > 0) {
        return parsed.sort((a, b) => b.mem - a.mem).slice(0, topN);
      }
    } catch (winErr) {
      log.warn("Fast tasklist process query failed, falling back to systeminformation", {
        error: winErr instanceof Error ? winErr.message : String(winErr),
      });
    }
  }

  try {
    const si = (await import("systeminformation")).default;
    const procs = await si.processes();
    return procs.list
      .sort((a, b) => b.cpu - a.cpu)
      .slice(0, topN)
      .map(p => ({ name: p.name, cpu: Math.round(p.cpu * 10) / 10, mem: Math.round(p.mem * 10) / 10, pid: p.pid }));
  } catch (err: any) {
    log.error("Failed to retrieve system process list", err);
    return [];
  }
}

export async function killProcess(pid: number): Promise<{ success: boolean; pid: number; message: string }> {
  if (!pid || pid <= 4) {
    throw new SafetyError(`Cannot kill protected system process PID: ${pid}`);
  }
  try {
    process.kill(pid);
    log.tool(`Killed process PID: ${pid}`);
    return { success: true, pid, message: `Successfully terminated process PID ${pid}` };
  } catch (err: any) {
    throw new ToolError("system.process_kill", `Failed to terminate process PID ${pid}: ${err.message}`);
  }
}

export async function clipboardOp(action: "read" | "write", text?: string): Promise<string> {
  log.tool(`Clipboard operation: ${action}`);
  return osClipboard(action, text);
}

export async function getEnvironmentVars(keys?: string[]): Promise<Record<string, string>> {
  const safeEnv: Record<string, string> = {};
  const allowedKeys = keys || ["NODE_ENV", "PATH", "OS", "SHELL", "FILE_ROOT", "PLAYWRIGHT_BROWSER"];

  for (const key of allowedKeys) {
    if (process.env[key] !== undefined) {
      safeEnv[key] = process.env[key]!;
    }
  }

  return safeEnv;
}

export async function getBatteryStatus(): Promise<string> {
  const si = (await import("systeminformation")).default;
  const bat = await si.battery();
  if (!bat.hasBattery) return "No battery (desktop)";
  return `${bat.percent}% ${bat.isCharging ? "⚡ charging" : "🔋 on battery"}`;
}

export async function adjustVolume(
  direction: "up" | "down" | "mute" | "unmute" | "set",
  value = 10
): Promise<{ success: boolean; message: string; volume?: number; muted?: boolean }> {
  try {
    if (process.platform === "win32") {
      const { exec } = await import("child_process");
      const path = await import("path");
      const { fileURLToPath } = await import("url");
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const scriptPath = path.join(currentDir, "volumeControl.ps1");

      const res = await new Promise<{ volume?: number; muted?: boolean }>((resolve, reject) => {
        exec(
          `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Action ${direction} -Value ${value}`,
          { windowsHide: true },
          (err, stdout) => {
            if (err) {
              // Fallback to WScript.Shell SendKeys loop if execution policy or COM fails
              const charCode = direction === "down" ? 174 : direction === "mute" || direction === "unmute" ? 173 : 175;
              const repeat = direction === "mute" || direction === "unmute" ? 1 : 5;
              const fallbackCmd = `powershell -NoProfile -Command "1..${repeat} | ForEach-Object { (New-Object -ComObject WScript.Shell).SendKeys([char]${charCode}) }"`;
              exec(fallbackCmd, { windowsHide: true }, (fbErr) => {
                if (fbErr) reject(err);
                else resolve({});
              });
            } else {
              try {
                const parsed = JSON.parse(stdout.trim());
                resolve(parsed);
              } catch {
                resolve({});
              }
            }
          }
        );
      });

      if (direction === "set") {
        return { success: true, message: `Volume set to ${res.volume ?? value}%`, volume: res.volume, muted: res.muted };
      }
      if (direction === "mute") {
        return { success: true, message: "Volume muted", muted: true };
      }
      if (direction === "unmute") {
        return { success: true, message: "Volume unmuted", muted: false };
      }
      const volInfo = res.volume !== undefined ? ` to ${res.volume}%` : "";
      return { success: true, message: `Volume adjusted (${direction})${volInfo}`, volume: res.volume, muted: res.muted };
    } else {
      return { success: true, message: `Volume adjustment not implemented for ${process.platform}` };
    }
  } catch (err: any) {
    throw new ToolError("system.volume", `Failed to adjust volume: ${err.message}`);
  }
}
