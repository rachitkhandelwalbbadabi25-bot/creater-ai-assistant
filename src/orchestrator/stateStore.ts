// src/orchestrator/stateStore.ts
/**
 * Simple in‑memory task state store with optional JSON persistence.
 *
 * Persistence is controlled by the `STATE_PERSISTENCE` environment variable.
 * When enabled, the store writes `data/state.json` and checkpoint files
 * under `data/checkpoints/`.
 */
import { promises as fs } from 'fs';
import { join } from 'path';

export interface TaskState {
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  steps: unknown[];
  outputs: unknown[];
  artifacts: unknown[];
  errors: unknown[];
  metadata?: Record<string, unknown>;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

/** Configuration check helper */
function isPersistenceEnabled(): boolean {
  return process.env.STATE_PERSISTENCE === 'true';
}

/** Base data directory (project root) */
const DATA_ROOT = join(process.cwd(), 'data');
const STATE_FILE = join(DATA_ROOT, 'state.json');
const CHECKPOINTS_DIR = join(DATA_ROOT, 'checkpoints');

/** In‑memory map of task states */
const store = new Map<string, TaskState>();

/** Ensure the data directories exist when persistence is enabled */
async function ensureDataDirs(): Promise<void> {
  if (!isPersistenceEnabled()) return;
  await fs.mkdir(DATA_ROOT, { recursive: true });
  await fs.mkdir(CHECKPOINTS_DIR, { recursive: true });
}

/** Deep clone a TaskState – safe for test isolation */
function clone<T>(obj: T): T {
  // structuredClone is available in recent Node versions; fallback to JSON round‑trip
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return typeof (globalThis as any).structuredClone === 'function'
    ? (globalThis as any).structuredClone(obj)
    : (JSON.parse(JSON.stringify(obj)) as T);
}

/** Create a new task with default empty arrays */
export function createTask(taskId: string, partial?: Partial<TaskState>): TaskState {
  const now = new Date().toISOString();
  const base: TaskState = {
    taskId,
    status: 'pending',
    steps: [],
    outputs: [],
    artifacts: [],
    errors: [],
    metadata: partial?.metadata ?? {},
    createdAt: now,
    updatedAt: now,
    ...(partial || {}),
  };
  store.set(taskId, base);
  // Persist immediately if enabled
  if (isPersistenceEnabled()) {
    void persistState();
  }
  return clone(base);
}

/** Update an existing task – `updater` receives the current state and must return a new state */
export function updateTask(taskId: string, updater: (state: TaskState) => TaskState): TaskState {
  const current = store.get(taskId);
  if (!current) throw new Error(`Task ${taskId} not found`);
  const updated = updater({ ...current, updatedAt: new Date().toISOString() });
  updated.updatedAt = new Date().toISOString();
  store.set(taskId, updated);
  if (isPersistenceEnabled()) {
    void persistState();
  }
  return clone(updated);
}

/** Retrieve a deep clone of a task, or undefined if missing */
export function getTask(taskId: string): TaskState | undefined {
  const found = store.get(taskId);
  return found ? clone(found) : undefined;
}

/** List all task states (deep cloned) */
export function listTasks(): TaskState[] {
  return Array.from(store.values()).map(clone);
}

/** Delete a task from the store */
export function deleteTask(taskId: string): void {
  store.delete(taskId);
  if (isPersistenceEnabled()) {
    void persistState();
    // Also remove checkpoint if it exists
    const chkPath = join(CHECKPOINTS_DIR, `${taskId}.json`);
    void fs.unlink(chkPath).catch(() => {});
  }
}

/** Save a checkpoint for a specific task */
export async function saveCheckpoint(taskId: string): Promise<void> {
  if (!isPersistenceEnabled()) return;
  const task = store.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  await ensureDataDirs();
  const checkpointPath = join(CHECKPOINTS_DIR, `${taskId}.json`);
  await fs.writeFile(checkpointPath, JSON.stringify(task, null, 2), 'utf8');
}

/** Persist the entire store to `state.json` */
export async function persistState(): Promise<void> {
  if (!isPersistenceEnabled()) return;
  await ensureDataDirs();
  const obj: Record<string, TaskState> = {};
  for (const [id, state] of store.entries()) {
    obj[id] = state;
  }
  await fs.writeFile(STATE_FILE, JSON.stringify(obj, null, 2), 'utf8');
}

/** Load persisted state from disk (if any) */
export async function loadState(): Promise<void> {
  if (!isPersistenceEnabled()) return;
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    const parsed: Record<string, TaskState> = JSON.parse(raw);
    store.clear();
    for (const [id, state] of Object.entries(parsed)) {
      store.set(id, state);
    }
  } catch (err) {
    // If file does not exist, ignore – start with an empty store
    if ((err as any).code !== 'ENOENT') {
      throw err;
    }
  }
}

/** Export internal constants for testing purposes */
export const _INTERNAL = {
  DATA_ROOT,
  STATE_FILE,
  CHECKPOINTS_DIR,
  store,
};
