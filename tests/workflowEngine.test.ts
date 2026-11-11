import { describe, it, expect, beforeEach } from "./bunTestPolyfill.js";
import * as fs from "fs";
import * as path from "path";
import {
  createWorkflow,
  startWorkflow,
  executeNextStep,
  executeAllSteps,
  pauseWorkflow,
  resumeWorkflow,
  cancelWorkflow,
  getWorkflow,
  getWorkflowStatus,
  listWorkflows,
  deleteWorkflow,
} from "../src/workflow/workflowEngine.js";
import { WorkflowError } from "../src/workflow/types.js";

describe("Phase 6.1 — Workflow Engine Foundation Tests", () => {
  let wfId: string;

  beforeEach(() => {
    // Clean up past test workflows if any
    listWorkflows().forEach((wf) => deleteWorkflow(wf.id));
  });

  it("1. Workflow creation persists workflow structure with PENDING initial state", () => {
    const wf = createWorkflow({
      name: "Test Workflow 1",
      description: "Basic FS Read & Info Workflow",
      steps: [
        { name: "Step 1", type: "TOOL", input: { toolId: "system.info" } },
        { name: "Step 2", type: "ACTION", input: { actionName: "log_status" } },
      ],
    });

    expect(wf.id).toBeDefined();
    expect(wf.name).toBe("Test Workflow 1");
    expect(wf.status).toBe("PENDING");
    expect(wf.steps.length).toBe(2);
    expect(wf.currentStepIndex).toBe(0);

    wfId = wf.id;
  });

  it("2. Initial state is PENDING and steps have PENDING status", () => {
    const wf = createWorkflow({
      name: "Test Workflow 2",
      steps: [{ name: "Init Step", type: "TOOL", input: { toolId: "system.info" } }],
    });

    expect(wf.status).toBe("PENDING");
    expect(wf.steps[0].status).toBe("PENDING");
    expect(wf.steps[0].retryCount).toBe(0);
  });

  it("3. Starting workflow transitions PENDING to RUNNING", async () => {
    const wf = createWorkflow({
      name: "Test Workflow 3",
      steps: [{ name: "Step A", type: "TOOL", input: { toolId: "system.info" } }],
    });

    const startedWf = await startWorkflow(wf.id);
    expect(startedWf.status).toBe("RUNNING");
    expect(startedWf.startedAt).toBeGreaterThan(0);
  });

  it("4. Sequential step execution advances step index correctly", async () => {
    const wf = createWorkflow({
      name: "Test Workflow 4",
      steps: [
        { name: "Step A", type: "TOOL", input: { toolId: "system.info" } },
        { name: "Step B", type: "ACTION", input: { actionName: "custom_act" } },
      ],
    });

    await startWorkflow(wf.id);

    const step1 = await executeNextStep(wf.id);
    expect(step1.workflow.currentStepIndex).toBe(1);
    expect(step1.workflow.status).toBe("RUNNING");
    expect(step1.stepResult?.status).toBe("COMPLETED");

    const step2 = await executeNextStep(wf.id);
    expect(step2.workflow.status).toBe("COMPLETED");
  });

  it("5. Successful completion marks workflow COMPLETED with completedAt timestamp", async () => {
    const wf = createWorkflow({
      name: "Completion Test",
      steps: [{ name: "Only Step", type: "TOOL", input: { toolId: "system.info" } }],
    });

    const completed = await executeAllSteps(wf.id);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).toBeGreaterThan(0);
  });

  it("6. Failed step transitions workflow to FAILED state and halts execution", async () => {
    const wf = createWorkflow({
      name: "Failure Test",
      steps: [
        { name: "Fail Step", type: "TOOL", input: { toolId: "non_existent_tool_id" } },
        { name: "Never Executed", type: "TOOL", input: { toolId: "system.info" } },
      ],
    });

    await startWorkflow(wf.id);

    await expect(executeNextStep(wf.id)).rejects.toThrow();

    const failedWf = getWorkflow(wf.id);
    expect(failedWf?.status).toBe("FAILED");
    expect(failedWf?.currentStepIndex).toBe(0);
    expect(failedWf?.steps[0].status).toBe("FAILED");
  });

  it("7. Invalid state transition is rejected (e.g. COMPLETED -> RUNNING)", async () => {
    const wf = createWorkflow({
      name: "Invalid Transition",
      steps: [{ name: "Step 1", type: "TOOL", input: { toolId: "system.info" } }],
    });

    await executeAllSteps(wf.id);

    // Try starting a completed workflow
    try {
      await startWorkflow(wf.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err instanceof WorkflowError).toBe(true);
      expect(err.code).toBe("VALIDATION_ERROR");
    }
  });

  it("8. Pause workflow stops advancement of steps", async () => {
    const wf = createWorkflow({
      name: "Pause Test",
      steps: [
        { name: "Step 1", type: "TOOL", input: { toolId: "system.info" } },
        { name: "Step 2", type: "TOOL", input: { toolId: "system.info" } },
      ],
    });

    await startWorkflow(wf.id);
    const paused = pauseWorkflow(wf.id);
    expect(paused.status).toBe("PAUSED");

    // Attempting executeNextStep on PAUSED workflow throws error
    try {
      await executeNextStep(wf.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err instanceof WorkflowError).toBe(true);
      expect(err.code).toBe("VALIDATION_ERROR");
    }
  });

  it("9. Resume workflow transitions PAUSED back to RUNNING and continues execution", async () => {
    const wf = createWorkflow({
      name: "Resume Test",
      steps: [{ name: "Step 1", type: "TOOL", input: { toolId: "system.info" } }],
    });

    await startWorkflow(wf.id);
    pauseWorkflow(wf.id);

    const resumed = await resumeWorkflow(wf.id);
    expect(resumed.status).toBe("RUNNING");

    const res = await executeNextStep(wf.id);
    expect(res.workflow.status).toBe("COMPLETED");
  });

  it("10. Cancel workflow marks status CANCELLED and cancels non-completed steps", async () => {
    const wf = createWorkflow({
      name: "Cancel Test",
      steps: [
        { name: "Step 1", type: "TOOL", input: { toolId: "system.info" } },
        { name: "Step 2", type: "TOOL", input: { toolId: "system.info" } },
      ],
    });

    await startWorkflow(wf.id);
    const cancelled = cancelWorkflow(wf.id);

    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.steps[0].status).toBe("CANCELLED");
    expect(cancelled.steps[1].status).toBe("CANCELLED");
  });

  it("11. Cancelled workflow cannot execute next step", async () => {
    const wf = createWorkflow({
      name: "Cancelled Exec Test",
      steps: [{ name: "Step 1", type: "TOOL", input: { toolId: "system.info" } }],
    });

    cancelWorkflow(wf.id);
    try {
      await executeNextStep(wf.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err instanceof WorkflowError).toBe(true);
      expect(err.code).toBe("VALIDATION_ERROR");
    }
  });

  it("12. Idempotency protection prevents executing completed step twice", async () => {
    const wf = createWorkflow({
      name: "Idempotency Test",
      steps: [{ name: "Step 1", type: "TOOL", input: { toolId: "system.info" } }],
    });

    await startWorkflow(wf.id);
    await executeNextStep(wf.id);

    // Call executeNextStep again on completed workflow - should reject with VALIDATION_ERROR
    try {
      await executeNextStep(wf.id);
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err instanceof WorkflowError).toBe(true);
      expect(err.code).toBe("VALIDATION_ERROR");
    }
  });

  it("13. Tool execution routes through existing dispatcher (fs.write_file & fs.read_file)", async () => {
    const testFile = path.join(process.cwd(), "data", "checkpoints", "wf_disp_test.txt");

    const wf = createWorkflow({
      name: "Dispatcher Test",
      steps: [
        { name: "Write", type: "TOOL", input: { toolId: "fs.write_file", params: { path: testFile, content: "Workflow Engine Data" } } },
        { name: "Read", type: "TOOL", input: { toolId: "fs.read_file", params: { path: testFile } } },
      ],
    });

    const completed = await executeAllSteps(wf.id);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.steps[1].output).toBe("Workflow Engine Data");

    if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
  });

  it("14. Safety layer remains active and blocks dangerous operations in workflow step", async () => {
    const wf = createWorkflow({
      name: "Safety Test Workflow",
      steps: [
        {
          name: "Dangerous Shell",
          type: "TOOL",
          input: { toolId: "shell.execute", params: { command: "rm -rf /" } },
        },
      ],
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

  it("15. Structured WorkflowError is propagated with error codes", async () => {
    const wf = createWorkflow({
      name: "Error Prop Test",
      steps: [{ name: "Bad Tool", type: "TOOL", input: { toolId: "invalid.tool.name" } }],
    });

    await startWorkflow(wf.id);
    try {
      await executeNextStep(wf.id);
      expect(true).toBe(false); // Should not reach here
    } catch (err: any) {
      expect(err instanceof WorkflowError).toBe(true);
      expect(err.code).toBe("SAFETY_ERROR");
    }
  });

  it("16. Workflow state is persisted and retrieved via getWorkflow & listWorkflows", () => {
    const wf = createWorkflow({
      name: "Persistence Workflow",
      steps: [{ name: "Step 1", type: "TOOL", input: { toolId: "system.info" } }],
    });

    const retrieved = getWorkflow(wf.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(wf.id);

    const all = listWorkflows();
    expect(all.some((w) => w.id === wf.id)).toBe(true);
  });

  it("17. Observability events and workflow status lookups return consistent values", () => {
    const wf = createWorkflow({
      name: "Observability Test",
      steps: [{ name: "Step 1", type: "TOOL", input: { toolId: "system.info" } }],
    });

    expect(getWorkflowStatus(wf.id)).toBe("PENDING");
  });

  it("18. Empty workflow parameters fail validation", () => {
    try {
      createWorkflow({ name: "Empty", steps: [] });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err instanceof WorkflowError).toBe(true);
      expect(err.code).toBe("VALIDATION_ERROR");
    }
  });

  it("19. Invalid workflow parameters fail validation", () => {
    try {
      createWorkflow({ name: "", steps: [{ name: "S", type: "TOOL", input: {} }] });
      expect(true).toBe(false);
    } catch (err: any) {
      expect(err instanceof WorkflowError).toBe(true);
      expect(err.code).toBe("VALIDATION_ERROR");
    }
  });

  it("20. Multiple workflows execute independently without corrupting each other's state", async () => {
    const wf1 = createWorkflow({
      name: "WF 1",
      steps: [{ name: "W1 Step", type: "TOOL", input: { toolId: "system.info" } }],
    });

    const wf2 = createWorkflow({
      name: "WF 2",
      steps: [{ name: "W2 Step", type: "TOOL", input: { toolId: "system.info" } }],
    });

    await startWorkflow(wf1.id);
    await startWorkflow(wf2.id);

    await executeNextStep(wf1.id);

    expect(getWorkflowStatus(wf1.id)).toBe("COMPLETED");
    expect(getWorkflowStatus(wf2.id)).toBe("RUNNING");

    await executeNextStep(wf2.id);
    expect(getWorkflowStatus(wf2.id)).toBe("COMPLETED");
  });
});
