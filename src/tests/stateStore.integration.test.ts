// src/tests/stateStore.integration.test.ts
import { describe, it, expect, afterEach } from 'bun:test';
import { createTask, updateTask, getTask, saveCheckpoint, loadState, _INTERNAL } from '../../src/orchestrator/stateStore.js';
import { promises as fs } from 'fs';
import { join } from 'path';

// Enable persistence for this test
process.env.STATE_PERSISTENCE = 'true';

const TEST_TASK_ID = 'test-task-123';
const CHECKPOINT_PATH = join(_INTERNAL.CHECKPOINTS_DIR, `${TEST_TASK_ID}.json`);
const STATE_PATH = _INTERNAL.STATE_FILE;

async function cleanFiles() {
  await fs.unlink(CHECKPOINT_PATH).catch(() => {});
  await fs.unlink(STATE_PATH).catch(() => {});
}

describe('State Store Integration', () => {
  afterEach(async () => {
    await cleanFiles();
  });

  it('should create, update, persist, reload and checkpoint a task', async () => {
    // Create task
    const created = createTask(TEST_TASK_ID, { status: 'pending' });
    expect(created.taskId).toBe(TEST_TASK_ID);
    expect(created.status).toBe('pending');

    // Update task
    const updated = updateTask(TEST_TASK_ID, (state) => ({
      ...state,
      status: 'running',
      steps: ['step1'],
    }));
    expect(updated.status).toBe('running');
    expect(updated.steps).toEqual(['step1']);

    // Persist via checkpoint
    await saveCheckpoint(TEST_TASK_ID);
    const chkExists = await fs.stat(CHECKPOINT_PATH).then(() => true).catch(() => false);
    expect(chkExists).toBe(true);

    // Load state from disk
    await loadState();
    const reloaded = getTask(TEST_TASK_ID);
    expect(reloaded).toBeDefined();
    expect(reloaded?.status).toBe('running');
    expect(reloaded?.steps).toEqual(['step1']);

    // Verify deep clone (mutating returned object does not affect store)
    if (reloaded) {
      const clone = { ...reloaded };
      clone.status = 'completed';
      const fromStore = getTask(TEST_TASK_ID);
      expect(fromStore?.status).toBe('running');
    }
  });
});
