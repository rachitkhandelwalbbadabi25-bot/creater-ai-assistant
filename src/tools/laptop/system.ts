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
        timeRemaining: battery.timeRemaining > 0 ? `${Math.round(battery.timeRemaining / 60)}h ${battery.timeRemaining % 60}m` : "calculating",
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

// Run the background update loop every 30 seconds
setInterval(updateMetricsInBackground, 30000);
// Trigger initial fetch immediately
updateMetricsInBackground();

export async function getSystemInfo(): Promise<SystemSnapshot> {
  return cachedSnapshot;
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
