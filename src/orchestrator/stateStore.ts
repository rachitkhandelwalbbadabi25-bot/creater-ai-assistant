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

/**
 * Deep clone helper that preserves state isolation while supporting
 * compound data types, functions (callables), Dates, RegExps, Maps, Sets,
 * and circular references without throwing DataCloneError.
 */
export function deepClone<T>(value: T, seen = new WeakMap<object, any>()): T {
  // 1. Primitives & non-objects
  if (value === null || typeof value !== 'object') {
    return value;
  }

  // 2. Circular reference protection
  if (seen.has(value)) {
    return seen.get(value);
  }

  // 3. Dates
  if (value instanceof Date) {
    const copy = new Date(value.getTime()) as unknown as T;
    seen.set(value, copy);
    return copy;
  }

  // 4. RegExps
  if (value instanceof RegExp) {
    const copy = new RegExp(value.source, value.flags) as unknown as T;
    seen.set(value, copy);
    return copy;
  }

  // 5. Maps
  if (value instanceof Map) {
    const copy = new Map() as unknown as T;
    seen.set(value, copy);
    for (const [k, v] of (value as Map<any, any>).entries()) {
      (copy as Map<any, any>).set(deepClone(k, seen), deepClone(v, seen));
    }
    return copy;
  }

  // 6. Sets
  if (value instanceof Set) {
    const copy = new Set() as unknown as T;
    seen.set(value, copy);
    for (const item of (value as Set<any>).values()) {
      (copy as Set<any>).add(deepClone(item, seen));
    }
    return copy;
  }

  // 7. Arrays
  if (Array.isArray(value)) {
    const copy: any[] = new Array(value.length);
    seen.set(value, copy);
    for (let i = 0; i < value.length; i++) {
      copy[i] = deepClone(value[i], seen);
    }
    return copy as unknown as T;
  }

  // 8. Plain & custom objects
  const proto = Object.getPrototypeOf(value);
  const copy: Record<string | symbol, any> = proto ? Object.create(proto) : {};
  seen.set(value, copy);

  for (const key of Reflect.ownKeys(value)) {
    try {
      const desc = Object.getOwnPropertyDescriptor(value, key);
      if (desc) {
        if (typeof desc.get === 'function' || typeof desc.set === 'function') {
          Object.defineProperty(copy, key, desc);
        } else if (typeof desc.value !== 'undefined') {
          copy[key] = deepClone(desc.value, seen);
        } else {
          Object.defineProperty(copy, key, desc);
        }
      }
    } catch (err: any) {
      console.error(`[stateStore/deepClone] Failed to clone property [${String(key)}]:`, err?.message || err);
    }
  }

  return copy as unknown as T;
}

/** Deep clone a TaskState – safe for test isolation */
function clone<T>(obj: T): T {
  return deepClone(obj);
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
  };
  if (partial) {
    try {
      for (const key of Reflect.ownKeys(partial)) {
        const desc = Object.getOwnPropertyDescriptor(partial, key);
        if (desc) {
          Object.defineProperty(base, key, desc);
        }
      }
    } catch (err: any) {
      console.error(`[stateStore] Failed to merge partial state for task [${taskId}]:`, err?.message || err);
    }
  }
  store.set(taskId, base);
  // Persist immediately if enabled
  if (isPersistenceEnabled()) {
    void persistState();
  }
  try {
    return clone(base);
  } catch (err: any) {
    console.error(`[stateStore] Failed to clone task [${taskId}] on creation:`, err?.message || err);
    return base;
  }
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
  if (!found) return undefined;
  try {
    return clone(found);
  } catch (err: any) {
    console.error(`[stateStore] Failed to clone task [${taskId}]:`, err?.message || err);
    return undefined;
  }
}

/** List all task states (deep cloned) */
export function listTasks(): TaskState[] {
  const result: TaskState[] = [];
  for (const [id, task] of store.entries()) {
    try {
      result.push(clone(task));
    } catch (err: any) {
      console.error(`[stateStore] Failed to clone task [${id}]:`, err?.message || err);
    }
  }
  return result;
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
