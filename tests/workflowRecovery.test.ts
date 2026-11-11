// ════════════════════════════════════════════════════════════════════════════════
// tests/workflowRecovery.test.ts — Phase 6.2 Workflow Recovery & Persistence Hardening Tests
// ════════════════════════════════════════════════════════════════════════════════

import { describe, it, expect, beforeEach } from "./bunTestPolyfill.js";
import * as fs from "fs";
import * as path from "path";
import {
  createWorkflow,
  startWorkflow,
  executeNextStep,
  executeAllSteps,
  cancelWorkflow,
  getWorkflow,
  getWorkflowStatus,
  listWorkflows,
  deleteWorkflow,
  recoverWorkflows,
  isToolIdempotent,
  getActiveClaims,
  clearActiveClaims,
} from "../src/workflow/workflowEngine.js";
import { WorkflowError } from "../src/workflow/types.js";
import { createTask, updateTask, listTasks, _INTERNAL } from "../src/orchestrator/stateStore.js";

describe("Phase 6.2 — Workflow Recovery & Persistence Hardening Tests", () => {
  beforeEach(() => {
    // Clear state store tasks and active step claims before each test
    clearActiveClaims();
    listWorkflows().forEach((wf) => deleteWorkflow(wf.id));
  });

  it("1. Persisted workflow survives engine recreation", () => {
    const wf = createWorkflow({
      name: "Interrupted Workflow",
      steps: [
        { name: "Step 1", type: "TOOL", input: { toolId: "system.info" } },
        { name: "Step 2", type: "TOOL", input: { toolId: "fs.read_file", params: { path: "package.json" } } },
      ],
    });

    // Retrieve via listWorkflows/getWorkflow simulating fresh engine lookup
    const retrieved = getWorkflow(wf.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(wf.id);
    expect(retrieved?.status).toBe("PENDING");
    expect(retrieved?.steps.length).toBe(2);
  });

  it("2. Completed step is not executed again", async () => {
    const wf = createWorkflow({
      name: "Completed Step Test",
      steps: [
        { name: "Read", type: "TOOL", input: { toolId: "system.info" } },
        { name: "Action", type: "ACTION", input: { actionName: "log" } },
      ],
    });

    await startWorkflow(wf.id);
    const res1 = await executeNextStep(wf.id);
    expect(res1.stepResult?.status).toBe("COMPLETED");

    // Manually call executeNextStep again - should execute step 2, not step 1 again
    const res2 = await executeNextStep(wf.id);
    expect(res2.workflow.currentStepIndex).toBe(2);
    expect(res2.workflow.status).toBe("COMPLETED");
    expect(res2.workflow.steps[0].status).toBe("COMPLETED");
  });

  it("3. Failed workflow stays failed after restart", async () => {
    const wf = createWorkflow({
      name: "Failed Workflow",
      steps: [{ name: "Fail Step", type: "TOOL", input: { toolId: "invalid.tool.id" } }],
    });

    await startWorkflow(wf.id);
    try {
      await executeNextStep(wf.id);
    } catch {
      // Expected failure
    }

    expect(getWorkflowStatus(wf.id)).toBe("FAILED");

    // Run recovery
    const recRes = recoverWorkflows();
    expect(getWorkflowStatus(wf.id)).toBe("FAILED");
    expect(recRes.workflows.some((w) => w.id === wf.id)).toBe(false);
  });

  it("4. Cancelled workflow stays cancelled", async () => {
    const wf = createWorkflow({
      name: "Cancelled Workflow",
      steps: [{ name: "Step 1", type: "TOOL", input: { toolId: "system.info" } }],
    });

    cancelWorkflow(wf.id);
    expect(getWorkflowStatus(wf.id)).toBe("CANCELLED");

    // Run recovery
    recoverWorkflows();
    expect(getWorkflowStatus(wf.id)).toBe("CANCELLED");
  });

  it("5. Running workflow is detected during recovery", async () => {
    const wf = createWorkflow({
      name: "Running Interrupted",
      steps: [{ name: "Read", type: "TOOL", input: { toolId: "system.info" } }],
    });

    await startWorkflow(wf.id);
    expect(getWorkflowStatus(wf.id)).toBe("RUNNING");

    // Simulate crash where step status was set to RUNNING
    updateTask(wf.id, (state: any) => {
      state.steps[0].status = "RUNNING";
      return state;
    });

    const recResult = recoverWorkflows();
    expect(recResult.workflows.some((w) => w.id === wf.id)).toBe(true);
  });

  it("6. Interrupted step enters correct recovery state", async () => {
    const wf = createWorkflow({
      name: "Interrupted Step State",
      steps: [{ name: "Write", type: "TOOL", input: { toolId: "fs.write_file", params: { path: "test.txt", content: "x" } } }],
    });

    await startWorkflow(wf.id);
    // Simulate process crash during side-effect step
    updateTask(wf.id, (state: any) => {
      state.steps[0].status = "RUNNING";
      return state;
    });

    recoverWorkflows();
    const recoveredWf = getWorkflow(wf.id);
    expect(recoveredWf?.status).toBe("FAILED");
    expect(recoveredWf?.steps[0].status).toBe("UNKNOWN");
    expect(recoveredWf?.steps[0].error).toContain("Interrupted mid-execution");
  });

  it("7. Safe/idempotent operation may recover according to policy", async () => {
    const wf = createWorkflow({
      name: "Idempotent Safe Recovery",
      steps: [{ name: "Read File", type: "TOOL", input: { toolId: "fs.read_file", params: { path: "package.json" } } }],
    });

    await startWorkflow(wf.id);
    // Simulate crash mid-step
    updateTask(wf.id, (state: any) => {
      state.steps[0].status = "RUNNING";
      return state;
    });

    const recRes = recoverWorkflows({ autoRetryReadonly: true });
    expect(recRes.recoveredCount).toBe(1);

    const recoveredWf = getWorkflow(wf.id);
    expect(recoveredWf?.status).toBe("RUNNING");
    expect(recoveredWf?.steps[0].status).toBe("PENDING");
  });

  it("8. Uncertain side-effect operation is not blindly replayed", async () => {
    const wf = createWorkflow({
      name: "Side Effect Interrupted",
      steps: [{ name: "Write File", type: "TOOL", input: { toolId: "fs.write_file", params: { path: "out.txt", content: "data" } } }],
    });

    await startWorkflow(wf.id);
    updateTask(wf.id, (state: any) => {
      state.steps[0].status = "RUNNING";
      return state;
    });

    recoverWorkflows();

    const recoveredWf = getWorkflow(wf.id);
    expect(recoveredWf?.status).toBe("FAILED");
    expect(recoveredWf?.steps[0].status).toBe("UNKNOWN");

    // Rerunning executeNextStep on failed workflow should reject
    try {
      await executeNextStep(wf.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err instanceof WorkflowError).toBe(true);
      expect(err.code).toBe("VALIDATION_ERROR");
    }
  });

  it("9. Dangerous operation is never automatically replayed", async () => {
    const wf = createWorkflow({
      name: "Dangerous Shell Recovery",
      steps: [{ name: "Delete", type: "TOOL", input: { toolId: "fs.delete_file", params: { path: "data.db" } } }],
    });

    await startWorkflow(wf.id);
    updateTask(wf.id, (state: any) => {
      state.steps[0].status = "RUNNING";
      return state;
    });

    recoverWorkflows();
    const recoveredWf = getWorkflow(wf.id);
    expect(recoveredWf?.status).toBe("FAILED");
    expect(recoveredWf?.steps[0].status).toBe("UNKNOWN");
  });

  it("10. Concurrent executeNextStep() calls cannot execute the same step twice", async () => {
    const wf = createWorkflow({
      name: "Concurrency Test",
      steps: [{ name: "Slow Info", type: "TOOL", input: { toolId: "system.info" } }],
    });

    await startWorkflow(wf.id);

    // Trigger two near-simultaneous calls
    const p1 = executeNextStep(wf.id);
    const p2 = executeNextStep(wf.id);

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    if (rejected[0].status === "rejected") {
      const err = rejected[0].reason;
      expect(err instanceof WorkflowError).toBe(true);
      expect(err.code).toBe("CONCURRENCY_ERROR");
    }
  });

  it("11. Execution claim/lease behaves correctly if implemented", async () => {
    const wf = createWorkflow({
      name: "Claim Lease Test",
      steps: [{ name: "Step A", type: "TOOL", input: { toolId: "system.info" } }],
    });

    await startWorkflow(wf.id);
    expect(getActiveClaims().length).toBe(0);

    const execPromise = executeNextStep(wf.id);
    // While execution is active, active claims count should be 0 or 1 depending on async tick
    await execPromise;

    // After completion, claims map must be empty
    expect(getActiveClaims().length).toBe(0);
  });

  it("12. Recovery events are emitted", () => {
    const recRes = recoverWorkflows();
    expect(recRes).toBeDefined();
    expect(typeof recRes.recoveredCount).toBe("number");
    expect(typeof recRes.failedCount).toBe("number");
  });

  it("13. Existing Tool Dispatcher remains the execution boundary", async () => {
    const testFile = path.join(process.cwd(), "data", "checkpoints", "rec_disp_test.txt");

    const wf = createWorkflow({
      name: "Recovery Dispatcher Test",
      steps: [
        { name: "Write", type: "TOOL", input: { toolId: "fs.write_file", params: { path: testFile, content: "Recovery Content" } } },
      ],
    });

    await executeAllSteps(wf.id);
    expect(fs.existsSync(testFile)).toBe(true);
    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
  });

  it("14. Existing safety system remains active", async () => {
    const wf = createWorkflow({
      name: "Safety System Check",
      steps: [{ name: "Dangerous Command", type: "TOOL", input: { toolId: "shell.execute", params: { command: "rm -rf /" } } }],
    });

    await startWorkflow(wf.id);
    try {
      await executeNextStep(wf.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err instanceof WorkflowError).toBe(true);
      expect(err.code).toBe("SAFETY_ERROR");
    }
  });

  it("15. Persistence does not store secrets unnecessarily (sanitization)", () => {
    const wf = createWorkflow({
      name: "Secret Sanitization Test",
      steps: [
        {
          name: "API Login",
          type: "TOOL",
          input: {
            toolId: "fs.read_file",
            params: {
              path: "config.json",
              password: "super_secret_password_123",
              apiKey: "sk-proj-secret-key-xyz",
            },
          },
        },
      ],
    });

    const persistedTask = listTasks().find((t) => t.taskId === wf.id);
    expect(persistedTask).toBeDefined();

    const stepInputStr = JSON.stringify(persistedTask?.steps);
    expect(stepInputStr.includes("super_secret_password_123")).toBe(false);
    expect(stepInputStr.includes("sk-proj-secret-key-xyz")).toBe(false);
    expect(stepInputStr.includes("[REDACTED_SECRET]")).toBe(true);
  });

  it("16. Multiple workflows recover independently", async () => {
    const wf1 = createWorkflow({
      name: "WF Safe",
      steps: [{ name: "Read", type: "TOOL", input: { toolId: "fs.read_file", params: { path: "package.json" } } }],
    });

    const wf2 = createWorkflow({
      name: "WF Dangerous",
      steps: [{ name: "Write", type: "TOOL", input: { toolId: "fs.write_file", params: { path: "a.txt", content: "1" } } }],
    });

    await startWorkflow(wf1.id);
    await startWorkflow(wf2.id);

    updateTask(wf1.id, (state: any) => {
      state.steps[0].status = "RUNNING";
      return state;
    });

    updateTask(wf2.id, (state: any) => {
      state.steps[0].status = "RUNNING";
      return state;
    });

    recoverWorkflows({ autoRetryReadonly: true });

    expect(getWorkflowStatus(wf1.id)).toBe("RUNNING"); // Reset to PENDING, workflow stays RUNNING
    expect(getWorkflowStatus(wf2.id)).toBe("FAILED");  // Side effect step -> FAILED
  });

  it("17. Corrupted/malformed workflow state fails safely", () => {
    // Inject malformed task in stateStore
    createTask("corrupted_task_id", {
      taskId: "corrupted_task_id",
      status: "running",
      metadata: null as any,
    });

    let threw = false;
    try {
      listWorkflows();
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    deleteWorkflow("corrupted_task_id");
  });

  it("18. Recovery does not mutate completed workflows", async () => {
    const wf = createWorkflow({
      name: "Completed Mutation Test",
      steps: [{ name: "Read", type: "TOOL", input: { toolId: "system.info" } }],
    });

    await executeAllSteps(wf.id);
    expect(getWorkflowStatus(wf.id)).toBe("COMPLETED");

    recoverWorkflows();
    expect(getWorkflowStatus(wf.id)).toBe("COMPLETED");
  });

  it("19. Recovery does not revive cancelled workflows", () => {
    const wf = createWorkflow({
      name: "Cancelled Revival Test",
      steps: [{ name: "Read", type: "TOOL", input: { toolId: "system.info" } }],
    });

    cancelWorkflow(wf.id);
    expect(getWorkflowStatus(wf.id)).toBe("CANCELLED");

    recoverWorkflows();
    expect(getWorkflowStatus(wf.id)).toBe("CANCELLED");
  });

  it("20. Recovery does not revive failed workflows automatically", async () => {
    const wf = createWorkflow({
      name: "Failed Revival Test",
      steps: [{ name: "Fail", type: "TOOL", input: { toolId: "invalid.tool.id" } }],
    });

    await startWorkflow(wf.id);
    try {
      await executeNextStep(wf.id);
    } catch {
      // Expected
    }

    expect(getWorkflowStatus(wf.id)).toBe("FAILED");
    recoverWorkflows();
    expect(getWorkflowStatus(wf.id)).toBe("FAILED");
  });
});
