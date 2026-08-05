// src/tests/orchestrator/health.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { QueueManager } from '../../orchestrator/queueManager.js';
import { MAX_CONCURRENT_WORKFLOWS } from '../../orchestrator/queueManager.js';

// We test health logic directly against a local QueueManager instance
// to avoid global state contamination from internalOrchestrator tests.
// The getOrchestratorHealth function delegates straight to globalQueueManager,
// so we verify the underlying getters on a fresh instance here.

describe('getOrchestratorHealth (via QueueManager)', () => {
  let q: QueueManager;

  beforeEach(() => {
    q = new QueueManager();
  });

  it('returns zero counts on an idle queue', () => {
    expect(q.getActiveCount()).toBe(0);
    expect(q.getQueuedCount()).toBe(0);
    expect(q.getActiveTaskIds()).toEqual([]);
    expect(q.getQueuedTaskIds()).toEqual([]);
  });

  it('reports maxConcurrentWorkflows correctly', () => {
    // Verify the constant matches the expected cap
    expect(MAX_CONCURRENT_WORKFLOWS).toBe(3);
  });

  it('increments activeCount when a task starts', async () => {
    let resolve!: () => void;
    const p = q.enqueue(
      () => new Promise<void>((r) => { resolve = r; }),
      'health-active'
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(q.getActiveCount()).toBe(1);
    expect(q.getActiveTaskIds()).toContain('health-active');
    resolve();
    await p;
    expect(q.getActiveCount()).toBe(0);
  });

  it('increments queuedCount when slots are full', async () => {
    const resolvers: Array<() => void> = [];
    const active: Array<Promise<any>> = [];
    for (let i = 0; i < MAX_CONCURRENT_WORKFLOWS; i++) {
      active.push(
        q.enqueue(
          () => new Promise<void>((r) => resolvers.push(r)),
          `h-active-${i}`
        )
      );
    }
    await new Promise((r) => setTimeout(r, 0));
    // Now enqueue beyond capacity
    q.enqueue(() => Promise.resolve('q'), 'h-queued');
    expect(q.getQueuedCount()).toBe(1);
    expect(q.getQueuedTaskIds()).toContain('h-queued');
    resolvers.forEach((r) => r());
    await Promise.all(active);
  });

  it('drains queued tasks to active after slot opens', async () => {
    let resolveFirst!: () => void;
    const firstDone = q.enqueue(
      () => new Promise<void>((r) => { resolveFirst = r; }),
      'first'
    );
    await new Promise((r) => setTimeout(r, 0));
    // Queue a second task
    const second = q.enqueue(() => Promise.resolve('done'), 'second');
    expect(q.getQueuedCount()).toBe(0); // still has a free slot
    resolveFirst();
    await Promise.all([firstDone, second]);
    expect(q.getActiveCount()).toBe(0);
    expect(q.getQueuedCount()).toBe(0);
  });

  it('activeTaskIds is a defensive copy (mutation safe)', async () => {
    let resolve!: () => void;
    const p = q.enqueue(
      () => new Promise<void>((r) => { resolve = r; }),
      'safe-task'
    );
    await new Promise((r) => setTimeout(r, 0));
    const ids = q.getActiveTaskIds();
    ids.push('injected'); // mutate the returned copy
    expect(q.getActiveTaskIds()).not.toContain('injected');
    resolve();
    await p;
  });
});

// ── Integration: health module re-export ─────────────────────────────────────

describe('getOrchestratorHealth() export', () => {
  it('returns the expected shape', async () => {
    const { getOrchestratorHealth } = await import('../../orchestrator/health.js');
    const health = getOrchestratorHealth();
    expect(typeof health.activeWorkflows).toBe('number');
    expect(typeof health.queuedWorkflows).toBe('number');
    expect(typeof health.maxConcurrentWorkflows).toBe('number');
    expect(Array.isArray(health.activeTaskIds)).toBe(true);
    expect(Array.isArray(health.queuedTaskIds)).toBe(true);
    expect(health.maxConcurrentWorkflows).toBe(MAX_CONCURRENT_WORKFLOWS);
  });
});
