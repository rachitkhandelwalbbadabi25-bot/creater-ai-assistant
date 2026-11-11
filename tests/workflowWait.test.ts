import { describe, it, expect, beforeEach } from "./bunTestPolyfill.js";
import {
  createWorkflow,
  startWorkflow,
  executeNextStep,
  executeAllSteps,
  resumeWaitingWorkflows,
  pauseWorkflow,
  resumeWorkflow,
  cancelWorkflow,
  getWorkflow,
  getWorkflowStatus,
  listWorkflows,
  deleteWorkflow,
  recoverWorkflows,
} from "../src/workflow/workflowEngine.js";
import { WorkflowError } from "../src/workflow/types.js";
import { recordMetric, getObservabilityMetrics } from "../src/monitoring/metrics.js";

describe("Phase 6.4 — WAIT Workflow Foundation Tests", () => {
  beforeEach(() => {
    // Clean up past workflows before each test
    listWorkflows().forEach((wf) => deleteWorkflow(wf.id));
  });

  it("1. WAIT step is recognized in workflow creation and step formatting", () => {
    const wf = createWorkflow({
      name: "Wait Recognition Test",
      steps: [
        { name: "Delay Step", type: "WAIT", input: { durationMs: 5000 } },
        { name: "Final Step", type: "ACTION", input: { actionName: "done" } },
      ],
    });

    expect(wf.steps[0].type).toBe("WAIT");
    expect(wf.steps[0].input.durationMs).toBe(5000);
    expect(wf.steps[0].status).toBe("PENDING");
  });

  it("2. WAIT duration validation rejects missing or non-positive durationMs when resumeAt is absent", async () => {
    const wf = createWorkflow({
      name: "Invalid Wait Test",
      steps: [{ name: "Bad Wait", type: "WAIT", input: {} }],
    });

    await startWorkflow(wf.id);
    await expect(executeNextStep(wf.id)).rejects.toThrow("WAIT step");
  });

  it("3. WAIT creates persisted resumeAt timestamp when step executes", async () => {
    const startTime = Date.now();
    const wf = createWorkflow({
      name: "Persisted ResumeAt Test",
      steps: [{ name: "Wait Step", type: "WAIT", input: { durationMs: 10000 } }],
    });

    await startWorkflow(wf.id);
    const res = await executeNextStep(wf.id);

    expect(res.workflow.status).toBe("WAITING");
    const step = res.workflow.steps[0];
    expect(step.status).toBe("WAITING");
    expect(step.input.resumeAt).toBeGreaterThanOrEqual(startTime + 10000);
  });

  it("4. WAIT step does not block the Node.js process / thread", async () => {
    const start = Date.now();
    const wf = createWorkflow({
      name: "Non-blocking Test",
      steps: [
        { name: "Long Wait", type: "WAIT", input: { durationMs: 60000 } },
        { name: "Action", type: "ACTION", input: { actionName: "finish" } },
      ],
    });

    await startWorkflow(wf.id);
    await executeNextStep(wf.id);
    const elapsed = Date.now() - start;

    // Execution must return immediately without sleeping for 60 seconds
    expect(elapsed).toBeLessThan(500);
  });

  it("5. Workflow enters correct WAITING state", async () => {
    const wf = createWorkflow({
      name: "Waiting State Test",
      steps: [{ name: "Pause", type: "WAIT", input: { durationMs: 5000 } }],
    });

    await startWorkflow(wf.id);
    await executeNextStep(wf.id);

    const fetched = getWorkflow(wf.id);
    expect(fetched?.status).toBe("WAITING");
    expect(fetched?.steps[0].status).toBe("WAITING");
  });

  it("6. Workflow does not execute next step before resumeAt is reached", async () => {
    let actionExecuted = false;
    const wf = createWorkflow({
      name: "Premature Execution Test",
      steps: [
        { name: "Wait 10s", type: "WAIT", input: { durationMs: 10000 } },
        {
          name: "Guard Action",
          type: "ACTION",
          input: {
            actionFn: () => { actionExecuted = true; return true; },
          },
        },
      ],
    });

    await startWorkflow(wf.id);
    await executeNextStep(wf.id);

    // Try to resume immediately with current time (before 10s passed)
    const resumed = await resumeWaitingWorkflows(Date.now());

    expect(resumed.length).toBe(0);
    expect(actionExecuted).toBe(false);
    expect(getWorkflowStatus(wf.id)).toBe("WAITING");
  });

  it("7. Workflow resumes after resumeAt timestamp is reached", async () => {
    const now = Date.now();
    const wf = createWorkflow({
      name: "Resume After ResumeAt Test",
      steps: [
        { name: "Wait Step", type: "WAIT", input: { durationMs: 1000 } },
        { name: "Next Step", type: "ACTION", input: { actionName: "resumed" } },
      ],
    });

    await startWorkflow(wf.id);
    await executeNextStep(wf.id);

    // Simulate clock advancing past 1000ms
    const futureTime = now + 1500;
    const resumed = await resumeWaitingWorkflows(futureTime);

    expect(resumed.length).toBe(1);
    expect(resumed[0].id).toBe(wf.id);
    expect(getWorkflowStatus(wf.id)).toBe("COMPLETED");
  });

  it("8. WAIT step becomes COMPLETED after resume", async () => {
    const now = Date.now();
    const wf = createWorkflow({
      name: "Step Completion Test",
      steps: [{ name: "Wait Step", type: "WAIT", input: { durationMs: 500 } }],
    });

    await startWorkflow(wf.id);
    await executeNextStep(wf.id);

    await resumeWaitingWorkflows(now + 600);

    const fetched = getWorkflow(wf.id);
    expect(fetched?.steps[0].status).toBe("COMPLETED");
    expect(fetched?.steps[0].output).toBeDefined();
  });

  it("9. Next step executes exactly once after resumption", async () => {
    let executionCount = 0;
    const wf = createWorkflow({
      name: "Exactly Once Test",
      steps: [
        { name: "Wait", type: "WAIT", input: { durationMs: 100 } },
        {
          name: "Increment",
          type: "ACTION",
          input: {
            actionFn: () => { executionCount++; },
          },
        },
      ],
    });

    await startWorkflow(wf.id);
    await executeNextStep(wf.id);

    const futureTime = Date.now() + 200;
    await resumeWaitingWorkflows(futureTime);
    await resumeWaitingWorkflows(futureTime + 100);

    expect(executionCount).toBe(1);
  });

  it("10. WAIT survives engine state reload from persistence", async () => {
    const now = Date.now();
    const wf = createWorkflow({
      name: "Persistence Reload Test",
      steps: [
        { name: "Persisted Wait", type: "WAIT", input: { durationMs: 2000 } },
        { name: "Final Step", type: "ACTION", input: { actionName: "persisted_ok" } },
      ],
    });

    await startWorkflow(wf.id);
    await executeNextStep(wf.id);

    // Fetch directly from DB / StateStore
    const reloadedWf = getWorkflow(wf.id);
    expect(reloadedWf?.status).toBe("WAITING");

    // Resume using reloaded state
    const resumed = await resumeWaitingWorkflows(now + 2500);
    expect(resumed.length).toBe(1);
    expect(getWorkflow(wf.id)?.status).toBe("COMPLETED");
  });

  it("11. WAIT survives process restart simulation", async () => {
    const now = Date.now();
    const wf = createWorkflow({
      name: "Restart Simulation Test",
      steps: [{ name: "Wait Step", type: "WAIT", input: { durationMs: 3000 } }],
    });

    await startWorkflow(wf.id);
    await executeNextStep(wf.id);

    // Simulate crash recovery scan
    const recoveryResult = recoverWorkflows();
    expect(recoveryResult.failedCount).toBe(0);

    // Workflow must still be WAITING
    expect(getWorkflowStatus(wf.id)).toBe("WAITING");

    // Advance time and resume
    const resumed = await resumeWaitingWorkflows(now + 3500);
    expect(resumed.length).toBe(1);
    expect(getWorkflowStatus(wf.id)).toBe("COMPLETED");
  });

  it("12. Concurrent resume attempts cannot duplicate execution", async () => {
    let callCount = 0;
    const wf = createWorkflow({
      name: "Concurrent Resume Lock Test",
      steps: [
        { name: "Wait", type: "WAIT", input: { durationMs: 100 } },
        {
          name: "Target Action",
          type: "ACTION",
          input: {
            actionFn: () => { callCount++; },
          },
        },
      ],
    });

    await startWorkflow(wf.id);
    await executeNextStep(wf.id);

    const futureTime = Date.now() + 200;

    // Trigger two concurrent resume attempts
    const [res1, res2] = await Promise.all([
      resumeWaitingWorkflows(futureTime),
      resumeWaitingWorkflows(futureTime),
    ]);

    const totalResumed = res1.length + res2.length;
    expect(totalResumed).toBe(1);
    expect(callCount).toBe(1);
  });

  it("13. Multiple waiting workflows operate independently", async () => {
    const now = Date.now();
    const wf1 = createWorkflow({
      name: "Short Wait Workflow",
      steps: [{ name: "Wait Short", type: "WAIT", input: { durationMs: 1000 } }],
    });

    const wf2 = createWorkflow({
      name: "Long Wait Workflow",
      steps: [{ name: "Wait Long", type: "WAIT", input: { durationMs: 5000 } }],
    });

    await startWorkflow(wf1.id);
    await executeNextStep(wf1.id);

    await startWorkflow(wf2.id);
    await executeNextStep(wf2.id);

    // At now + 2000ms: wf1 should resume, wf2 should remain waiting
    const res1 = await resumeWaitingWorkflows(now + 2000);
    expect(res1.length).toBe(1);
    expect(res1[0].id).toBe(wf1.id);
    expect(getWorkflowStatus(wf1.id)).toBe("COMPLETED");
    expect(getWorkflowStatus(wf2.id)).toBe("WAITING");

    // At now + 6000ms: wf2 should resume
    const res2 = await resumeWaitingWorkflows(now + 6000);
    expect(res2.length).toBe(1);
    expect(res2[0].id).toBe(wf2.id);
    expect(getWorkflowStatus(wf2.id)).toBe("COMPLETED");
  });

  it("14. Cancellation while waiting works safely", async () => {
    const wf = createWorkflow({
      name: "Cancel While Waiting Test",
      steps: [
        { name: "Wait 1min", type: "WAIT", input: { durationMs: 60000 } },
        { name: "Unreachable", type: "ACTION", input: { actionName: "nope" } },
      ],
    });

    await startWorkflow(wf.id);
    await executeNextStep(wf.id);

    expect(getWorkflowStatus(wf.id)).toBe("WAITING");

    const cancelled = cancelWorkflow(wf.id);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.steps[0].status).toBe("CANCELLED");

    // Resumption attempts must ignore cancelled workflows
    const resumed = await resumeWaitingWorkflows(Date.now() + 100000);
    expect(resumed.length).toBe(0);
  });

  it("15. Invalid WAIT configuration fails safely with validation error", async () => {
    const wf = createWorkflow({
      name: "Invalid Duration Test",
      steps: [{ name: "Negative Wait", type: "WAIT", input: { durationMs: -500 } }],
    });

    await startWorkflow(wf.id);
    await expect(executeNextStep(wf.id)).rejects.toThrow("WAIT step");
  });

  it("16. Safety remains active after WAIT step completes", async () => {
    const now = Date.now();
    const wf = createWorkflow({
      name: "Safety After Wait Test",
      steps: [
        { name: "Wait", type: "WAIT", input: { durationMs: 500 } },
        { name: "Unsafe Tool", type: "TOOL", input: { toolId: "dangerous_unknown_tool" } },
      ],
    });

    await startWorkflow(wf.id);
    await executeNextStep(wf.id);

    // Resumption will attempt to execute next step (TOOL)
    await expect(resumeWaitingWorkflows(now + 600)).rejects.toThrow("Safety policy blocked tool");
  });

  it("17. Observability metrics and log counters are recorded for WAITING states", async () => {
    const now = Date.now();
    const wf = createWorkflow({
      name: "Metrics Test Workflow",
      steps: [{ name: "Wait", type: "WAIT", input: { durationMs: 100 } }],
    });

    await startWorkflow(wf.id);
    await executeNextStep(wf.id);
    await resumeWaitingWorkflows(now + 200);

    const metrics = getObservabilityMetrics();
    const waitingEvent = metrics.find((m) => m.name === "workflow.step.waiting");
    const resumedEvent = metrics.find((m) => m.name === "workflow.step.resumed");
    expect(waitingEvent).toBeDefined();
    expect(resumedEvent).toBeDefined();
  });
});
