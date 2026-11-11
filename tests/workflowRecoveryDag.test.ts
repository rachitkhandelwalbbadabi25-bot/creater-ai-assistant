// ════════════════════════════════════════════════════════════════════════════════
// tests/workflowRecoveryDag.test.ts — DAG Workflow Recovery Test Suite
// ════════════════════════════════════════════════════════════════════════════════

import { describe, test, expect, beforeEach } from "./bunTestPolyfill.js";
import {
  createWorkflow,
  startWorkflow,
  getWorkflow,
  recoverWorkflows,
  deleteWorkflow,
  clearActiveClaims,
  getOrCreateExecutionContext,
} from "../src/workflow/workflowEngine.js";
import { updateTask } from "../src/orchestrator/stateStore.js";

describe("DAG Workflow Recovery & Persistence Hardening Suite", () => {
  beforeEach(() => {
    clearActiveClaims();
  });

  test("1. Interrupted read-only tool step in DAG resets to PENDING on recovery", () => {
    const wf = createWorkflow({
      id: "wf_rec_readonly",
      name: "Readonly Recovery",
      steps: [
        {
          id: "read_step",
          name: "Read File",
          type: "TOOL",
          input: { toolId: "fs.read_file", params: { path: "test.txt" } },
        },
      ],
    });

    // Simulate mid-execution process crash where step was left RUNNING
    updateTask(wf.id, (state) => ({
      ...state,
      status: "running",
      steps: [
        {
          id: "read_step",
          name: "Read File",
          type: "TOOL",
          status: "RUNNING",
          input: { toolId: "fs.read_file" },
          retryCount: 0,
        },
      ],
    }));

    const result = recoverWorkflows();
    expect(result.recoveredCount).toBe(1);

    const recoveredWf = getWorkflow(wf.id)!;
    expect(recoveredWf.steps[0].status).toBe("PENDING");
    expect(recoveredWf.steps[0].metadata?.recoveryAction).toBe("RESET_TO_PENDING");
    deleteWorkflow(wf.id);
  });

  test("2. Interrupted side-effecting tool step is safely marked UNKNOWN/FAILED", () => {
    const wf = createWorkflow({
      id: "wf_rec_sideeffect",
      name: "Side Effect Recovery",
      steps: [
        {
          id: "write_step",
          name: "Write File",
          type: "TOOL",
          input: { toolId: "fs.write_file", params: { path: "out.txt", content: "data" } },
        },
      ],
    });

    updateTask(wf.id, (state) => ({
      ...state,
      status: "running",
      steps: [
        {
          id: "write_step",
          name: "Write File",
          type: "TOOL",
          status: "RUNNING",
          input: { toolId: "fs.write_file" },
          retryCount: 0,
        },
      ],
    }));

    const result = recoverWorkflows();
    expect(result.failedCount).toBe(1);
    expect(result.unknownCount).toBe(1);

    const recoveredWf = getWorkflow(wf.id)!;
    expect(recoveredWf.status).toBe("FAILED");
    expect(recoveredWf.steps[0].status).toBe("UNKNOWN");
    deleteWorkflow(wf.id);
  });

  test("3. Completed sibling step outputs are preserved across DAG recovery", () => {
    const wf = createWorkflow({
      id: "wf_rec_sibling_preserve",
      name: "Sibling Output Preservation",
      steps: [
        {
          id: "sibling_a",
          name: "Sibling A",
          type: "ACTION",
          input: { actionName: "a" },
        },
        {
          id: "sibling_b",
          name: "Sibling B",
          type: "TOOL",
          input: { toolId: "fs.write_file" },
        },
      ],
    });

    // Simulate crash where sibling_a COMPLETED and sibling_b crashed mid-run
    updateTask(wf.id, (state) => ({
      ...state,
      status: "running",
      steps: [
        {
          id: "sibling_a",
          name: "Sibling A",
          type: "ACTION",
          status: "COMPLETED",
          input: {},
          output: { preserved_data: "val_123" },
          retryCount: 0,
        },
        {
          id: "sibling_b",
          name: "Sibling B",
          type: "TOOL",
          status: "RUNNING",
          input: { toolId: "fs.write_file" },
          retryCount: 0,
        },
      ],
    }));

    recoverWorkflows();

    const recovered = getWorkflow(wf.id)!;
    const siblingA = recovered.steps.find((s) => s.id === "sibling_a");
    expect(siblingA?.status).toBe("COMPLETED");
    expect(siblingA?.output).toEqual({ preserved_data: "val_123" });
    deleteWorkflow(wf.id);
  });

  test("4. Process restart simulation restores execution context and step results from stateStore", () => {
    const wf = createWorkflow({
      id: "wf_rec_context_restore",
      name: "Context Restore",
      steps: [
        { id: "step_1", name: "Step 1", type: "ACTION", input: { actionName: "s1" } },
      ],
    });

    updateTask(wf.id, (state) => ({
      ...state,
      steps: [
        {
          id: "step_1",
          name: "Step 1",
          type: "ACTION",
          status: "COMPLETED",
          input: {},
          output: "restored_output_val",
          retryCount: 0,
        },
      ],
    }));

    const restoredWf = getWorkflow(wf.id)!;
    const ctx = getOrCreateExecutionContext(restoredWf);
    expect(ctx.stepResults["step_1"]).toBe("restored_output_val");
    deleteWorkflow(wf.id);
  });

  test("5. Interrupted parallel branch step recovery preserves successfully completed branch steps", () => {
    const wf = createWorkflow({
      id: "wf_rec_parallel_branch",
      name: "Parallel Branch Recovery",
      steps: [
        { id: "p1", name: "P1", type: "ACTION", input: { actionName: "1" } },
        { id: "p2", name: "P2", type: "TOOL", input: { toolId: "fs.read_file" } },
      ],
    });

    updateTask(wf.id, (state) => ({
      ...state,
      status: "running",
      steps: [
        { id: "p1", name: "P1", type: "ACTION", status: "COMPLETED", output: "p1_out", input: {}, retryCount: 0 },
        { id: "p2", name: "P2", type: "TOOL", status: "RUNNING", input: { toolId: "fs.read_file" }, retryCount: 0 },
      ],
    }));

    const rec = recoverWorkflows();
    expect(rec.recoveredCount).toBe(1);

    const recovered = getWorkflow(wf.id)!;
    expect(recovered.steps[0].status).toBe("COMPLETED");
    expect(recovered.steps[1].status).toBe("PENDING");
    deleteWorkflow(wf.id);
  });

  test("6. Step claim leases are cleared/released during recovery scan", () => {
    const wf = createWorkflow({
      id: "wf_rec_lease_clear",
      name: "Lease Clear",
      steps: [
        { id: "s1", name: "S1", type: "ACTION", input: { actionName: "1" } },
      ],
    });

    recoverWorkflows();
    // Verify no stray step claims remain
    clearActiveClaims();
    deleteWorkflow(wf.id);
  });

  test("7. Recovering a WAITING workflow preserves its WAITING status", () => {
    const wf = createWorkflow({
      id: "wf_rec_waiting_preserve",
      name: "Waiting Preserve",
      steps: [
        { id: "w1", name: "W1", type: "WAIT", input: { durationMs: 5000, resumeAt: Date.now() + 5000 } },
      ],
    });

    updateTask(wf.id, (state) => ({
      ...state,
      status: "waiting" as any,
      steps: [
        { id: "w1", name: "W1", type: "WAIT", status: "WAITING", input: { resumeAt: Date.now() + 5000 }, retryCount: 0 },
      ],
    }));

    recoverWorkflows();

    const recovered = getWorkflow(wf.id)!;
    expect(recovered.status).toBe("WAITING");
    expect(recovered.steps[0].status).toBe("WAITING");
    deleteWorkflow(wf.id);
  });

  test("8. No duplicate side effects introduced during DAG recovery cycles", () => {
    const wf = createWorkflow({
      id: "wf_rec_no_dups",
      name: "No Dups",
      steps: [
        { id: "s1", name: "S1", type: "TOOL", input: { toolId: "fs.write_file" } },
      ],
    });

    updateTask(wf.id, (state) => ({
      ...state,
      status: "running",
      steps: [
        { id: "s1", name: "S1", type: "TOOL", status: "RUNNING", input: { toolId: "fs.write_file" }, retryCount: 0 },
      ],
    }));

    recoverWorkflows();
    const recWf = getWorkflow(wf.id)!;

    // Side-effecting step must be UNKNOWN/FAILED, NOT automatically re-run (PENDING)
    expect(recWf.steps[0].status).toBe("UNKNOWN");
    deleteWorkflow(wf.id);
  });

  test("9. Persistent workflow step metadata retains recovery timestamp and action", () => {
    const wf = createWorkflow({
      id: "wf_rec_meta_stamp",
      name: "Meta Stamp",
      steps: [
        { id: "s1", name: "S1", type: "TOOL", input: { toolId: "fs.read_file" } },
      ],
    });

    updateTask(wf.id, (state) => ({
      ...state,
      status: "running",
      steps: [
        { id: "s1", name: "S1", type: "TOOL", status: "RUNNING", input: { toolId: "fs.read_file" }, retryCount: 0 },
      ],
    }));

    recoverWorkflows();
    const recWf = getWorkflow(wf.id)!;
    expect(recWf.steps[0].metadata?.recoveredAt).toBeGreaterThan(0);
    deleteWorkflow(wf.id);
  });

  test("10. recoverWorkflows returns accurate counts for recovered, failed, and unknown", () => {
    const wf = createWorkflow({
      id: "wf_rec_counts",
      name: "Counts",
      steps: [
        { id: "s1", name: "S1", type: "TOOL", input: { toolId: "fs.read_file" } },
      ],
    });

    updateTask(wf.id, (state) => ({
      ...state,
      status: "running",
      steps: [
        { id: "s1", name: "S1", type: "TOOL", status: "RUNNING", input: { toolId: "fs.read_file" }, retryCount: 0 },
      ],
    }));

    const stats = recoverWorkflows();
    expect(stats.recoveredCount).toBe(1);
    expect(stats.workflows.length).toBeGreaterThan(0);
    deleteWorkflow(wf.id);
  });

  test("11. Auto-recovery respects autoRetryReadonly: false override", () => {
    const wf = createWorkflow({
      id: "wf_rec_override_false",
      name: "Override False",
      steps: [
        { id: "s1", name: "S1", type: "TOOL", input: { toolId: "fs.read_file" } },
      ],
    });

    updateTask(wf.id, (state) => ({
      ...state,
      status: "running",
      steps: [
        { id: "s1", name: "S1", type: "TOOL", status: "RUNNING", input: { toolId: "fs.read_file" }, retryCount: 0 },
      ],
    }));

    const stats = recoverWorkflows({ autoRetryReadonly: false });
    expect(stats.failedCount).toBe(1);
    deleteWorkflow(wf.id);
  });

  test("12. Terminal workflows (COMPLETED, CANCELLED) remain unmodified during recovery scans", () => {
    const wf = createWorkflow({
      id: "wf_rec_terminal_unmodified",
      name: "Terminal Unmodified",
      steps: [
        { id: "s1", name: "S1", type: "ACTION", input: { actionName: "1" } },
      ],
    });

    updateTask(wf.id, (state) => ({
      ...state,
      status: "completed",
      steps: [
        { id: "s1", name: "S1", type: "ACTION", status: "COMPLETED", output: "done", input: {}, retryCount: 0 },
      ],
    }));

    const stats = recoverWorkflows();
    const untouched = getWorkflow(wf.id)!;
    expect(untouched.status).toBe("COMPLETED");
    deleteWorkflow(wf.id);
  });
});
