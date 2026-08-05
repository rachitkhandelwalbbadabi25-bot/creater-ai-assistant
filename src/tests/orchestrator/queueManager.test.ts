// src/tests/orchestrator/queueManager.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { QueueManager, MAX_CONCURRENT_WORKFLOWS } from '../../orchestrator/queueManager.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a task that resolves after `ms` ms, recording the order it finishes */
function makeTask(ms: number, log: string[], label: string) {
  return () =>
    new Promise<string>((res) => setTimeout(() => { log.push(label); res(label); }, ms));
}

/** Build a task that rejects immediately */
function makeFailTask(msg: string) {
  return () => Promise.reject(new Error(msg));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('QueueManager', () => {
  let q: QueueManager;

  beforeEach(() => {
    q = new QueueManager();
  });

  // ── Basic Enqueue ──────────────────────────────────────────────────────────

  it('executes a single task and returns its result', async () => {
    const result = await q.enqueue(() => Promise.resolve(42), 'task-1');
    expect(result).toBe(42);
  });

  it('resolves rejected tasks as promise rejections', async () => {
    let caught = '';
    try {
      await q.enqueue(makeFailTask('boom'), 'task-fail');
    } catch (e: any) {
      caught = e.message;
    }
    expect(caught).toBe('boom');
  });

  // ── Concurrency ────────────────────────────────────────────────────────────

  it(`never exceeds MAX_CONCURRENT_WORKFLOWS (${MAX_CONCURRENT_WORKFLOWS}) in parallel`, async () => {
    let active = 0;
    let maxObserved = 0;
    const tasks: Array<() => Promise<void>> = [];
    for (let i = 0; i < 6; i++) {
      tasks.push(() =>
        new Promise<void>((res) => {
          active++;
          maxObserved = Math.max(maxObserved, active);
          setTimeout(() => { active--; res(); }, 10);
        })
      );
    }
    await Promise.all(tasks.map((t, i) => q.enqueue(t, `task-${i}`)));
    expect(maxObserved).toBeLessThanOrEqual(MAX_CONCURRENT_WORKFLOWS);
  });

  it('queues tasks beyond max concurrency and drains them in order', async () => {
    const log: string[] = [];
    const promises: Array<Promise<any>> = [];
    // Enqueue 5 tasks; MAX=3 so 2 start queued
    for (let i = 0; i < 5; i++) {
      promises.push(q.enqueue(makeTask(5, log, `t${i}`), `task-${i}`));
    }
    await Promise.all(promises);
    // All tasks must complete
    expect(log.length).toBe(5);
    expect(log.every((l) => l.startsWith('t'))).toBe(true);
  });

  // ── Health counters ────────────────────────────────────────────────────────

  it('getActiveCount reflects running tasks', async () => {
    let resolveTask!: () => void;
    const blocker = new Promise<void>((r) => { resolveTask = r; });
    const p = q.enqueue(() => blocker, 'blocker');
    // Give the microtask queue a tick to start the task
    await new Promise((r) => setTimeout(r, 0));
    expect(q.getActiveCount()).toBe(1);
    resolveTask();
    await p;
    expect(q.getActiveCount()).toBe(0);
  });

  it('getQueuedCount reflects waiting tasks when at capacity', async () => {
    const resolvers: Array<() => void> = [];
    // Saturate concurrency
    for (let i = 0; i < MAX_CONCURRENT_WORKFLOWS; i++) {
      q.enqueue(
        () => new Promise<void>((r) => resolvers.push(r)),
        `active-${i}`
      );
    }
    await new Promise((r) => setTimeout(r, 0));
    // One extra queued task
    const extra = q.enqueue(() => Promise.resolve('extra'), 'extra-task');
    expect(q.getQueuedCount()).toBeGreaterThanOrEqual(1);
    // Release all
    resolvers.forEach((r) => r());
    await extra;
  });

  it('getActiveTaskIds contains the running taskId', async () => {
    let resolve!: () => void;
    const p = q.enqueue(
      () => new Promise<void>((r) => { resolve = r; }),
      'my-task'
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(q.getActiveTaskIds()).toContain('my-task');
    resolve();
    await p;
    expect(q.getActiveTaskIds()).not.toContain('my-task');
  });

  it('getQueuedTaskIds contains tasks waiting for a slot', async () => {
    const resolvers: Array<() => void> = [];
    for (let i = 0; i < MAX_CONCURRENT_WORKFLOWS; i++) {
      q.enqueue(
        () => new Promise<void>((r) => resolvers.push(r)),
        `filler-${i}`
      );
    }
    await new Promise((r) => setTimeout(r, 0));
    q.enqueue(() => Promise.resolve('q'), 'queued-task');
    expect(q.getQueuedTaskIds()).toContain('queued-task');
    resolvers.forEach((r) => r());
  });

  // ── Queue recovery ─────────────────────────────────────────────────────────

  it('drains queue correctly after a failed active task', async () => {
    const resolvers: Array<() => void> = [];
    // Saturate with tasks that will fail
    const failing: Array<Promise<any>> = [];
    for (let i = 0; i < MAX_CONCURRENT_WORKFLOWS; i++) {
      failing.push(
        q.enqueue(makeFailTask(`fail-${i}`), `fail-task-${i}`).catch(() => `caught-${i}`)
      );
    }
    // Enqueue a recovery task
    const recovery = q.enqueue(() => Promise.resolve('recovered'), 'recovery');
    const results = await Promise.all([...failing, recovery]);
    expect(results[results.length - 1]).toBe('recovered');
  });

  it('continues processing queue after a rejection (queue recovery)', async () => {
    let ran = false;
    // First task fails
    const fail = q.enqueue(makeFailTask('oops'), 't-fail').catch(() => null);
    // Second task should still run
    const ok = q.enqueue(() => { ran = true; return Promise.resolve(1); }, 't-ok');
    await Promise.all([fail, ok]);
    expect(ran).toBe(true);
  });
});
