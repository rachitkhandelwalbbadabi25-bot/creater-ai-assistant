// No imports needed; using global process

interface MemoryInfo {
  rss: number; // Resident Set Size in MB
  heapUsed: number; // Heap used in MB
  heapTotal: number; // Heap total in MB
  external: number; // External memory in MB
}

let baseline: MemoryInfo | null = null;

function getCurrentMemory(): MemoryInfo {
  const mem = process.memoryUsage();
  return {
    rss: Math.round(mem.rss / 1024 / 1024),
    heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    external: Math.round(mem.external / 1024 / 1024),
  };
}

/**
 * Capture baseline memory snapshot on first call.
 * Subsequent calls return current memory and delta from baseline.
 */
export function takeMemorySnapshot(): { current: MemoryInfo; delta: Partial<MemoryInfo> } {
  const current = getCurrentMemory();
  if (!baseline) {
    baseline = current;
    return { current, delta: {} };
  }
  const delta: Partial<MemoryInfo> = {
    rss: current.rss - baseline.rss,
    heapUsed: current.heapUsed - baseline.heapUsed,
    heapTotal: current.heapTotal - baseline.heapTotal,
    external: current.external - baseline.external,
  };
  return { current, delta };
}

export function printMemoryReport(): void {
  const { current, delta } = takeMemorySnapshot();
  const format = (label: string, value: number, diff?: number): string => {
    const diffStr = diff !== undefined ? ` (${diff >= 0 ? "+" : ""}${diff} MB)` : "";
    return `${label}: ${value} MB${diffStr}`;
  };
  console.log("[MEMORY SNAPSHOT]");
  console.log(format("RSS", current.rss, delta.rss));
  console.log(format("Heap Used", current.heapUsed, delta.heapUsed));
  console.log(format("Heap Total", current.heapTotal, delta.heapTotal));
  console.log(format("External", current.external, delta.external));
}
