// src/tests/orchestrator/stateStore.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createTask,
  updateTask,
  getTask,
  listTasks,
  deleteTask,
  saveCheckpoint,
  persistState,
  loadState,
  _INTERNAL,
} from "../../orchestrator/stateStore.js";
import * as fs from "fs";
import * as path from "path";

beforeEach(() => {
  _INTERNAL.store.clear();
  process.env.STATE_PERSISTENCE = "true";
});

afterEach(() => {
  process.env.STATE_PERSISTENCE = "false";
  try {
    if (fs.existsSync(_INTERNAL.DATA_ROOT)) {
      fs.rmSync(_INTERNAL.DATA_ROOT, { recursive: true, force: true });
    }
  } catch (e) {
    // Windows file locking safety
  }
});

describe("stateStore", () => {
  it("creates, updates, and deletes tasks", () => {
    const task = createTask("task-123", { status: "pending" });
    expect(task.taskId).toBe("task-123");
    expect(task.status).toBe("pending");

    const updated = updateTask("task-123", (state) => {
      state.status = "running";
      return state;
    });
    expect(updated.status).toBe("running");

    const fetched = getTask("task-123");
    expect(fetched?.status).toBe("running");

    const all = listTasks();
    expect(all).toHaveLength(1);

    deleteTask("task-123");
    expect(getTask("task-123")).toBeUndefined();
  });

  it("returns a deep clone when fetching a task", () => {
    const task = createTask("clone-test", { steps: ["step1"] });
    const fetched1 = getTask("clone-test");
    const fetched2 = getTask("clone-test");

    expect(fetched1).toBeDefined();
    expect(fetched2).toBeDefined();
    expect(fetched1).not.toBe(fetched2);
    expect(fetched1?.steps).not.toBe(fetched2?.steps);

    // Modify clone and assert internal state remains unchanged
    fetched1!.steps.push("step2");
    const fetched3 = getTask("clone-test");
    expect(fetched3?.steps).toHaveLength(1);
  });

  it("handles persistence and checkpoints", async () => {
    createTask("persist-test", { status: "completed" });
    await persistState();

    expect(fs.existsSync(_INTERNAL.STATE_FILE)).toBeTrue();

    // Clear memory store and reload
    _INTERNAL.store.clear();
    await loadState();

    const loaded = getTask("persist-test");
    expect(loaded).toBeDefined();
    expect(loaded?.status).toBe("completed");

    // Checkpoint
    await saveCheckpoint("persist-test");
    const checkpointFile = path.join(_INTERNAL.CHECKPOINTS_DIR, "persist-test.json");
    expect(fs.existsSync(checkpointFile)).toBeTrue();
  });
});
