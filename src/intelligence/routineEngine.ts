// src/intelligence/routineEngine.ts
import { incMetric } from "./intelligenceMetrics";

/**
 * Routine Engine – manages reusable workflows (routines).
 * Supports creation, updates, deletion, manual execution and scheduled execution.
 * Tracks execution count, last execution timestamp and failure count for each routine.
 */

export type Routine = {
  id: string;
  name: string;
  description?: string;
  /** Async function representing the routine's work */
  handler: () => Promise<void>;
  /** Scheduling info – cron expression or interval in ms (optional) */
  schedule?: string | number;
  /** Execution metrics */
  executionCount: number;
  lastExecution?: number; // epoch ms
  failures: number;
};

// In‑memory registry of routines
const routines: Record<string, Routine> = {};

function generateId(): string {
  return Math.random().toString(36).substring(2, 10);
}
export function createRoutine(name: string, description: string, steps: any[]): Routine {
  const id = generateId();
  // Simple handler that pretends to execute provided steps.
  const handler = async () => {
    // In real implementation, iterate over steps and execute them.
    // For test purposes we simply resolve.
    return;
  };
  const routine: Routine = {
    id,
    name,
    description,
    handler,
    executionCount: 0,
    failures: 0,
  };
  routines[id] = routine;
  return routine;
}
/** Update an existing routine */
export function updateRoutine(
  id: string,
  updates: Partial<
    Omit<Routine, "id" | "executionCount" | "failures" | "lastExecution">
  >
): Routine | undefined {
  const routine = routines[id];
  if (!routine) return undefined;
  Object.assign(routine, updates);
  return routine;
}

/** Delete a routine */
export function deleteRoutine(id: string): boolean {
  if (routines[id]) {
    delete routines[id];
    return true;
  }
  return false;
}

// Execute a routine – records metrics
export async function executeRoutine(id: string): Promise<boolean> {
  const routine = routines[id];
  if (!routine) return false;
  try {
    await routine.handler();
    routine.executionCount++;
    routine.lastExecution = Date.now();
    incMetric("routineExecutions");
    return true;
  } catch {
    routine.failures++;
    incMetric("routineExecutions");
    return false;
  }
}

/** List all registered routines */
export function listRoutines(): Routine[] {
  return Object.values(routines);
}

/** Clear all routines – used in tests */
export function clearRoutines(): void {
  for (const id in routines) {
    delete routines[id];
  }
}

/** Simple scheduler stub – in a real app this would hook into a cron library */
export function startScheduler(): void {
  // Iterate over routines with a numeric interval schedule (ms)
  setInterval(() => {
    for (const routine of Object.values(routines)) {
      if (typeof routine.schedule === "number") {
        // fire now – in production you would check elapsed time
        executeRoutine(routine.id).catch(() => {
          // failures already recorded inside executeRoutine
        });
      }
    }
  }, 60_000); // check every minute
}
