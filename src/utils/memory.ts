import { createLogger } from "@utils/logger.js";
import { IS_RUNTIME_DEBUG } from "@utils/perf.js";

// Simple logger for memory snapshots – uses existing logger infrastructure
const log = createLogger("utils/memory");

/**
 * Logs a lightweight memory usage snapshot.
 *
 * @param context – a short string describing where the snapshot is taken.
 */
export function logMemorySnapshot(context: string): void {
  if (!IS_RUNTIME_DEBUG) {
    return;
  }

  const { rss, heapTotal, heapUsed, external } = process.memoryUsage();
  const toMiB = (bytes: number) => Math.round((bytes / 1024 / 1024) * 100) / 100;
  log.info("MEMORY SNAPSHOT", {
    context,
    rss: toMiB(rss),
    heapTotal: toMiB(heapTotal),
    heapUsed: toMiB(heapUsed),
    external: toMiB(external),
  });
}
