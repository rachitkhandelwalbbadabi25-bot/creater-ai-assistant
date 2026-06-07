import { createLogger } from "@utils/logger.js";

// Simple logger for memory snapshots – uses existing logger infrastructure
const log = createLogger("utils/memory");

/**
 * Logs a lightweight memory usage snapshot.
 *
 * @param context – a short string describing where the snapshot is taken.
 */
export function logMemorySnapshot(context: string): void {
  const { rss, heapTotal, heapUsed, external } = process.memoryUsage();
  // Convert bytes to MiB for easier reading
  const toMiB = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;
  log.info("MEMORY SNAPSHOT", {
    context,
    rss: toMiB(rss),
    heapTotal: toMiB(heapTotal),
    heapUsed: toMiB(heapUsed),
    external: toMiB(external),
  });
}
