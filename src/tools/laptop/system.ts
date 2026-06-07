// ════════════════════════════════════════════════════════════════════════════════
// src/tools/laptop/system.ts — System info: CPU, RAM, battery, processes, etc.
// ════════════════════════════════════════════════════════════════════════════════

// NOTE: systeminformation is imported dynamically to avoid static bundler resolution on non‑Windows platforms
import { createLogger } from "@utils/logger.js";
import { formatBytes } from "@utils/helpers.js";

const log = createLogger("tools/system");

export interface SystemSnapshot {
  cpu: { model: string; usage: number; cores: number; temp?: number };
  ram: { total: string; used: string; usagePercent: number };
  battery: { percent: number; charging: boolean; timeRemaining: string } | null;
  disk: Array<{ mount: string; total: string; used: string; usagePercent: number }>;
  uptime: string;
  os: string;
}

export async function getSystemInfo(): Promise<SystemSnapshot> {
  // Dynamic import only when needed
  const si = (await import("systeminformation")).default;
  log.tool("Fetching system info");

  const [cpu, cpuLoad, mem, battery, disk, osInfo, time] = await Promise.all([
    si.cpu(),
    si.currentLoad(),
    si.mem(),
    si.battery(),
    si.fsSize(),
    si.osInfo(),
    si.time(),
  ]);

  const cpuTemp = await si.cpuTemperature().catch(() => ({ main: undefined }));

  return {
    cpu: {
      model: `${cpu.manufacturer} ${cpu.brand}`,
      usage: Math.round(cpuLoad.currentLoad),
      cores: cpu.cores,
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
      timeRemaining: battery.timeRemaining > 0 ? `${Math.round(battery.timeRemaining / 60)}h ${battery.timeRemaining % 60}m` : "calculating",
    } : null,
    disk: disk.slice(0, 3).map(d => ({
      mount: d.mount,
      total: formatBytes(d.size),
      used: formatBytes(d.used),
      usagePercent: Math.round(d.use),
    })),
    uptime: `${Math.floor(time.uptime / 3600)}h ${Math.floor((time.uptime % 3600) / 60)}m`,
    os: `${osInfo.distro} ${osInfo.release}`,
  };
}

export async function getProcesses(topN = 10): Promise<Array<{ name: string; cpu: number; mem: number; pid: number }>> {
  const si = (await import("systeminformation")).default;
  const procs = await si.processes();
  return procs.list
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, topN)
    .map(p => ({ name: p.name, cpu: Math.round(p.cpu * 10) / 10, mem: Math.round(p.mem * 10) / 10, pid: p.pid }));
}

export async function getBatteryStatus(): Promise<string> {
  const si = (await import("systeminformation")).default;
  const bat = await si.battery();
  if (!bat.hasBattery) return "No battery (desktop)";
  return `${bat.percent}% ${bat.isCharging ? "⚡ charging" : "🔋 on battery"}`;
}
