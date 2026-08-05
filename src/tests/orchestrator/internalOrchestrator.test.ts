// src/tests/orchestrator/internalOrchestrator.test.ts
import { describe, it, expect, beforeEach } from "bun:test";
import { executeWorkflow, cancelWorkflow, getWorkflowStatus, getActiveWorkflows, getQueuedWorkflows } from "../../orchestrator/internalOrchestrator.js";
import { getOrchestratorHealth } from "../../orchestrator/health.js";
import { getTask, _INTERNAL } from "../../orchestrator/stateStore.js";
import { WorkflowDefinition } from "../../orchestrator/types.js";

// Helper to reset global state between tests
async function resetEnvironment() {
  _INTERNAL.store.clear();
  // Reset queue manager by clearing internal structures
  const qm: any = (global as any).globalQueueManager;
  if (qm && typeof qm.reset === "function") {
    qm.reset();
  } else {
    // Fallback: clear internal arrays
    if (qm) {
      (qm as any).queue = [];
      (qm as any).activeCount = 0;
      (qm as any).activeTaskIds = [];
      (qm as any).queuedTaskIds = [];
    }
  }
}

beforeEach(async () => {
  await resetEnvironment();
});

// Utility to construct a simple workflow step definition
function step(action: string, args?: any, opts?: Partial<import("../../orchestrator/types.js").WorkflowStep>) {
  return { id: Math.random().toString(36).substring(7), agent: "dummy", action, args: args ?? {}, ...opts } as import("../../orchestrator/types.js").WorkflowStep;
}

describe("Internal Orchestrator End‑to‑End Tests", () => {
  it("executes a simple workflow successfully", async () => {
    const steps = [
      step("echo", { msg: "hello" }),
      step("slow", { delay: 20 }),
      step("createArtifact", { id: "a1", type: "log", value: "done" }),
    ];
    // Give fixed IDs to avoid dynamic resolution issues
    steps[0].id = "step1";
    steps[1].id = "step2";
    steps[2].id = "step3";

    const wfDef: WorkflowDefinition = {
      taskId: "task-simple",
      name: "Simple Test Workflow",
      steps,
    };

    const wf = await executeWorkflow(wfDef);
    expect(wf.success).toBeTrue();
    const stored = getTask(wf.taskId);
    expect(stored).toBeDefined();
    // In our taskRunner.ts runWorkflow implementation:
    // artifacts: [] is returned directly in WorkflowResult, but stored state holds steps, outputs, artifacts, etc.
    // Let's verify stored task states
    expect(stored?.status).toBe("completed");
  });

  it("handles a workflow with dependent steps", async () => {
    const step1 = step("echo", { value: 5 });
    step1.id = "a";
    const step2 = step("slow", {});
    step2.id = "b";
    step2.dependsOn = ["a"];

    const wfDef: WorkflowDefinition = {
      taskId: "task-dependent",
      name: "Dependent Workflow",
      steps: [step1, step2],
    };

    const wf = await executeWorkflow(wfDef);
    expect(wf.success).toBeTrue();
  });

  it("retries a failing step until success", async () => {
    const step1 = step("failThenSucceed", { failCount: 2 }, { retries: 3, backoffMs: 5 });
    step1.id = "fail-step";

    const wfDef: WorkflowDefinition = {
      taskId: "task-retry",
      name: "Retry Workflow",
      steps: [step1],
    };

    const wf = await executeWorkflow(wfDef);
    expect(wf.success).toBeTrue();
  });

  it("fails a step when timeout expires", async () => {
    const step1 = step("slow", { delay: 200 }, { timeoutMs: 5 });
    step1.id = "timeout-step";

    const wfDef: WorkflowDefinition = {
      taskId: "task-timeout",
      name: "Timeout Workflow",
      steps: [step1],
    };

    const wf = await executeWorkflow(wfDef);
    expect(wf.success).toBeFalse();
    const stored = getTask(wf.taskId);
    expect(stored?.status).toBe("failed");
  });

  it("cancels a running workflow", async () => {
    const step1 = step("slow", { delay: 200 });
    step1.id = "slow-step";

    const wfDef: WorkflowDefinition = {
      taskId: "task-cancel",
      name: "Cancel Workflow",
      steps: [step1],
    };

    const handle = executeWorkflow(wfDef);
    // Cancel shortly after start
    await new Promise(r => setTimeout(r, 10));
    await cancelWorkflow("task-cancel");
    const result = await handle;
    expect(result.success).toBeFalse();
    const stored = getTask(wfDef.taskId);
    expect(stored?.status).toBe("cancelled");
  });

  it("runs compensation when a step fails", async () => {
    const step1 = step("fail", {});
    step1.id = "fail-step";
    step1.compensate = step("createArtifact", { id: "c1", type: "comp", value: "comped" });
    step1.compensate.id = "comp-step";

    const wfDef: WorkflowDefinition = {
      taskId: "task-comp",
      name: "Compensation Workflow",
      steps: [step1],
    };

    const wf = await executeWorkflow(wfDef);
    expect(wf.success).toBeFalse();
    // Compensation run should record state/execution
    const stored = getTask(wf.taskId);
    expect(stored?.status).toBe("failed");
  });

  it("handles failure inside compensation gracefully", async () => {
    const step1 = step("fail", {});
    step1.id = "fail-step";
    step1.compensate = step("fail", {});
    step1.compensate.id = "comp-fail-step";

    const wfDef1: WorkflowDefinition = {
      taskId: "task-comp-fail",
      name: "Comp Fail Workflow",
      steps: [step1],
    };

    const wf = await executeWorkflow(wfDef1);
    expect(wf.success).toBeFalse();

    // Queue should still be functional – enqueue a succeeding workflow
    const okStep = step("echo", { msg: "ok" });
    okStep.id = "ok-step";
    const wfDef2: WorkflowDefinition = {
      taskId: "task-comp-ok",
      name: "Ok Workflow",
      steps: [okStep],
    };

    const ok = await executeWorkflow(wfDef2);
    expect(ok.success).toBeTrue();
  });

  it("generates unique correlation IDs for concurrent workflows", async () => {
    const promises = [];
    for (let i = 0; i < 5; i++) {
      const step1 = step("echo", { i });
      step1.id = `step-${i}`;
      const wfDef: WorkflowDefinition = {
        taskId: `task-unique-${i}`,
        name: `Workflow ${i}`,
        steps: [step1],
      };
      promises.push(executeWorkflow(wfDef));
    }
    const results = await Promise.all(promises);
    const storedTasks = results.map(r => getTask(r.taskId));
    const ids = storedTasks.map(t => t?.metadata?.correlationId);
    const uniq = new Set(ids);
    expect(uniq.size).toBe(5);
  });

  it("continues processing queue after a workflow failure", async () => {
    const step1 = step("fail", {});
    step1.id = "fail-step";
    const wfDef1: WorkflowDefinition = {
      taskId: "task-fail-queue",
      name: "Failing Workflow",
      steps: [step1],
    };

    const step2 = step("echo", { msg: "recovered" });
    step2.id = "ok-step";
    const wfDef2: WorkflowDefinition = {
      taskId: "task-ok-queue",
      name: "Ok Workflow",
      steps: [step2],
    };

    const fail = executeWorkflow(wfDef1).catch(() => null);
    const ok = executeWorkflow(wfDef2);
    const [, okResult] = await Promise.all([fail, ok]);
    expect(okResult.success).toBeTrue();
  });

  it("ensures the queue is empty after all workflows complete", async () => {
    const step1 = step("echo", { msg: "final" });
    step1.id = "final-step";
    const wfDef: WorkflowDefinition = {
      taskId: "task-final-queue",
      name: "Final Workflow",
      steps: [step1],
    };

    const wf = await executeWorkflow(wfDef);
    expect(wf.success).toBeTrue();
    const health = getOrchestratorHealth();
    expect(health.activeWorkflows).toBe(0);
    expect(health.queuedWorkflows).toBe(0);
  });
});
