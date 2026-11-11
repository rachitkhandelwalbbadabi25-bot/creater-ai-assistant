// ════════════════════════════════════════════════════════════════════════════════
// tests/workflowDagParallel.test.ts — DAG & Parallel Execution Test Suite
// ════════════════════════════════════════════════════════════════════════════════

import { describe, test, expect, beforeEach } from "./bunTestPolyfill.js";
import {
  createWorkflow,
  startWorkflow,
  executeNextStep,
  executeAllSteps,
  getWorkflow,
  deleteWorkflow,
  clearActiveClaims,
} from "../src/workflow/workflowEngine.js";
import { validateDag, detectCycles, getExecutableSteps } from "../src/workflow/dagEvaluator.js";
import { WorkflowError } from "../src/workflow/types.js";

describe("DAG Graph Engine & Controlled Parallel Execution Suite", () => {
  beforeEach(() => {
    clearActiveClaims();
  });

  test("1. Simple dependency ordering: Step B waits for Step A", async () => {
    const wf = createWorkflow({
      id: "wf_dag_simple",
      name: "Simple DAG",
      steps: [
        { id: "step_a", name: "Step A", type: "ACTION", input: { actionName: "a" } },
        { id: "step_b", name: "Step B", type: "ACTION", dependsOn: ["step_a"], input: { actionName: "b" } },
      ],
    });

    await startWorkflow(wf.id);

    // Initial executable step should only be step_a
    const execBefore = getExecutableSteps(wf);
    expect(execBefore.length).toBe(1);
    expect(execBefore[0].id).toBe("step_a");

    const resA = await executeNextStep(wf.id, "step_a");
    expect(resA.stepResult?.status).toBe("COMPLETED");

    // Now step_b should be executable
    const execAfter = getExecutableSteps(resA.workflow);
    expect(execAfter.length).toBe(1);
    expect(execAfter[0].id).toBe("step_b");

    const completed = await executeAllSteps(wf.id);
    expect(completed.status).toBe("COMPLETED");
    deleteWorkflow(wf.id);
  });

  test("2. Multiple dependencies: Step C waits for Step A AND Step B", async () => {
    const wf = createWorkflow({
      id: "wf_dag_multi_dep",
      name: "Multi Dep DAG",
      steps: [
        { id: "step_a", name: "Step A", type: "ACTION", input: { actionName: "a" } },
        { id: "step_b", name: "Step B", type: "ACTION", input: { actionName: "b" } },
        {
          id: "step_c",
          name: "Step C",
          type: "ACTION",
          dependsOn: ["step_a", "step_b"],
          input: { actionName: "c" },
        },
      ],
    });

    await startWorkflow(wf.id);

    // Both A and B are ready root steps
    let exec = getExecutableSteps(wf);
    expect(exec.length).toBe(2);

    await executeNextStep(wf.id, "step_a");
    const wfAfterA = getWorkflow(wf.id)!;
    exec = getExecutableSteps(wfAfterA);
    expect(exec.length).toBe(1);
    expect(exec[0].id).toBe("step_b");

    await executeNextStep(wf.id, "step_b");
    const wfAfterB = getWorkflow(wf.id)!;
    exec = getExecutableSteps(wfAfterB);
    expect(exec.length).toBe(1);
    expect(exec[0].id).toBe("step_c");

    const done = await executeAllSteps(wf.id);
    expect(done.status).toBe("COMPLETED");
    deleteWorkflow(wf.id);
  });

  test("3. Independent root steps run concurrently in batch execution", async () => {
    let order: string[] = [];
    const wf = createWorkflow({
      id: "wf_dag_independent",
      name: "Independent Steps",
      steps: [
        {
          id: "step_1",
          name: "Step 1",
          type: "ACTION",
          input: {
            actionFn: async () => {
              order.push("1");
              return "res_1";
            },
          },
        },
        {
          id: "step_2",
          name: "Step 2",
          type: "ACTION",
          input: {
            actionFn: async () => {
              order.push("2");
              return "res_2";
            },
          },
        },
      ],
    });

    await startWorkflow(wf.id);
    const done = await executeAllSteps(wf.id);

    expect(done.status).toBe("COMPLETED");
    expect(order.length).toBe(2);
    expect(order).toContain("1");
    expect(order).toContain("2");
    deleteWorkflow(wf.id);
  });

  test("4. Topological dependency execution ordering: A -> (B, C) -> D", async () => {
    const executed: string[] = [];
    const wf = createWorkflow({
      id: "wf_dag_topo",
      name: "Topo Order",
      steps: [
        {
          id: "step_a",
          name: "A",
          type: "ACTION",
          input: { actionFn: () => executed.push("A") },
        },
        {
          id: "step_b",
          name: "B",
          type: "ACTION",
          dependsOn: ["step_a"],
          input: { actionFn: () => executed.push("B") },
        },
        {
          id: "step_c",
          name: "C",
          type: "ACTION",
          dependsOn: ["step_a"],
          input: { actionFn: () => executed.push("C") },
        },
        {
          id: "step_d",
          name: "D",
          type: "ACTION",
          dependsOn: ["step_b", "step_c"],
          input: { actionFn: () => executed.push("D") },
        },
      ],
    });

    await startWorkflow(wf.id);
    await executeAllSteps(wf.id);

    expect(executed[0]).toBe("A");
    expect(executed[3]).toBe("D");
    expect(executed).toContain("B");
    expect(executed).toContain("C");
    deleteWorkflow(wf.id);
  });

  test("5. Cycle detection: Throws error for circular dependency A -> B -> C -> A", () => {
    expect(() => {
      createWorkflow({
        id: "wf_cycle_3",
        name: "Cycle 3",
        steps: [
          { id: "a", name: "A", type: "ACTION", dependsOn: ["c"], input: { actionName: "a" } },
          { id: "b", name: "B", type: "ACTION", dependsOn: ["a"], input: { actionName: "b" } },
          { id: "c", name: "C", type: "ACTION", dependsOn: ["b"], input: { actionName: "c" } },
        ],
      });
    }).toThrow(WorkflowError);
  });

  test("6. Self-dependency: Throws error when step depends on itself", () => {
    expect(() => {
      createWorkflow({
        id: "wf_self_dep",
        name: "Self Dep",
        steps: [
          { id: "a", name: "A", type: "ACTION", dependsOn: ["a"], input: { actionName: "a" } },
        ],
      });
    }).toThrow(WorkflowError);
  });

  test("7. Missing dependency ID: Throws validation error on creation", () => {
    expect(() => {
      createWorkflow({
        id: "wf_missing_dep",
        name: "Missing Dep",
        steps: [
          { id: "a", name: "A", type: "ACTION", dependsOn: ["ghost_node"], input: { actionName: "a" } },
        ],
      });
    }).toThrow(WorkflowError);
  });

  test("8. Duplicate step ID: Throws validation error on creation", () => {
    expect(() => {
      createWorkflow({
        id: "wf_dup_id",
        name: "Dup ID",
        steps: [
          { id: "dup", name: "A", type: "ACTION", input: { actionName: "a" } },
          { id: "dup", name: "B", type: "ACTION", input: { actionName: "b" } },
        ],
      });
    }).toThrow(WorkflowError);
  });

  test("9. PARALLEL step type executes sub-steps concurrently", async () => {
    const wf = createWorkflow({
      id: "wf_parallel_type",
      name: "Parallel Step Type",
      steps: [
        {
          id: "par_step",
          name: "Parallel Group",
          type: "PARALLEL",
          input: {
            maxConcurrency: 2,
            parallelSteps: [
              {
                id: "sub_1",
                name: "Sub 1",
                type: "ACTION",
                status: "PENDING",
                retryCount: 0,
                input: { actionFn: () => "sub1_out" },
              },
              {
                id: "sub_2",
                name: "Sub 2",
                type: "ACTION",
                status: "PENDING",
                retryCount: 0,
                input: { actionFn: () => "sub2_out" },
              },
            ],
          },
        },
      ],
    });

    await startWorkflow(wf.id);
    const done = await executeAllSteps(wf.id);

    expect(done.status).toBe("COMPLETED");
    const parOut = done.steps[0].output as any;
    expect(parOut["sub_1"]).toBe("sub1_out");
    expect(parOut["sub_2"]).toBe("sub2_out");
    deleteWorkflow(wf.id);
  });

  test("10. maxConcurrency limits parallel step batch execution size", async () => {
    let activeExecutions = 0;
    let maxObservedActive = 0;

    const makeSlowAction = (id: string) => async () => {
      activeExecutions++;
      maxObservedActive = Math.max(maxObservedActive, activeExecutions);
      await new Promise((r) => setTimeout(r, 10));
      activeExecutions--;
      return id;
    };

    const wf = createWorkflow({
      id: "wf_concurrency_limit",
      name: "Concurrency Limit",
      metadata: { maxConcurrency: 2 },
      steps: [
        { id: "s1", name: "S1", type: "ACTION", input: { actionFn: makeSlowAction("s1") } },
        { id: "s2", name: "S2", type: "ACTION", input: { actionFn: makeSlowAction("s2") } },
        { id: "s3", name: "S3", type: "ACTION", input: { actionFn: makeSlowAction("s3") } },
        { id: "s4", name: "S4", type: "ACTION", input: { actionFn: makeSlowAction("s4") } },
      ],
    });

    await startWorkflow(wf.id);
    await executeAllSteps(wf.id);

    expect(maxObservedActive <= 2).toBe(true);
    deleteWorkflow(wf.id);
  });

  test("11. Step claim lease prevents duplicate concurrent step execution", async () => {
    const wf = createWorkflow({
      id: "wf_claim_lease",
      name: "Claim Lease",
      steps: [
        {
          id: "step_claim_target",
          name: "Target",
          type: "ACTION",
          input: {
            actionFn: async () => {
              await new Promise((r) => setTimeout(r, 20));
              return "done";
            },
          },
        },
      ],
    });

    await startWorkflow(wf.id);

    const promise1 = executeNextStep(wf.id, "step_claim_target");
    const promise2 = executeNextStep(wf.id, "step_claim_target");

    const [r1, r2] = await Promise.allSettled([promise1, promise2]);

    expect(r1.status === "fulfilled" || r2.status === "fulfilled").toBe(true);
    expect(r1.status === "rejected" || r2.status === "rejected").toBe(true);
    deleteWorkflow(wf.id);
  });

  test("12. Concurrent step claim collision throws CONCURRENCY_ERROR code", async () => {
    const wf = createWorkflow({
      id: "wf_claim_error_code",
      name: "Claim Error Code",
      steps: [
        {
          id: "step_target",
          name: "Target",
          type: "ACTION",
          input: {
            actionFn: async () => {
              await new Promise((r) => setTimeout(r, 30));
              return "ok";
            },
          },
        },
      ],
    });

    await startWorkflow(wf.id);

    const p1 = executeNextStep(wf.id, "step_target");
    let caughtErr: any = null;
    try {
      await executeNextStep(wf.id, "step_target");
    } catch (err: any) {
      caughtErr = err;
    }

    await p1;
    expect(caughtErr !== null).toBe(true);
    expect(caughtErr.code).toBe("CONCURRENCY_ERROR");
    deleteWorkflow(wf.id);
  });

  test("13. Completed step output is preserved in context stepResults", async () => {
    const wf = createWorkflow({
      id: "wf_step_results_preserve",
      name: "Preserve Results",
      steps: [
        {
          id: "producer",
          name: "Producer",
          type: "ACTION",
          input: { actionFn: () => ({ message: "hello_from_producer" }) },
        },
        {
          id: "consumer",
          name: "Consumer",
          type: "ACTION",
          dependsOn: ["producer"],
          input: {
            actionFn: (ctx) => {
              const prev = ctx.stepResults["producer"] as any;
              return `Received: ${prev.message}`;
            },
          },
        },
      ],
    });

    await startWorkflow(wf.id);
    const done = await executeAllSteps(wf.id);

    expect(done.status).toBe("COMPLETED");
    const consumerOut = done.steps.find((s) => s.id === "consumer")?.output;
    expect(consumerOut).toBe("Received: hello_from_producer");
    deleteWorkflow(wf.id);
  });

  test("14. Sibling failure in parallel graph preserves successful sibling outputs", async () => {
    const wf = createWorkflow({
      id: "wf_sibling_failure",
      name: "Sibling Failure",
      steps: [
        {
          id: "sub_success",
          name: "Success Sibling",
          type: "ACTION",
          input: { actionFn: () => "success_val" },
        },
        {
          id: "sub_fail",
          name: "Fail Sibling",
          type: "ACTION",
          input: {
            actionFn: () => {
              throw new Error("Sibling crash simulation");
            },
          },
        },
      ],
    });

    await startWorkflow(wf.id);
    try {
      await executeAllSteps(wf.id);
    } catch (_) {}

    const reloaded = getWorkflow(wf.id)!;
    expect(reloaded.status).toBe("FAILED");

    const successStep = reloaded.steps.find((s) => s.id === "sub_success");
    const failStep = reloaded.steps.find((s) => s.id === "sub_fail");

    expect(successStep?.status).toBe("COMPLETED");
    expect(successStep?.output).toBe("success_val");
    expect(failStep?.status).toBe("FAILED");
    deleteWorkflow(wf.id);
  });

  test("15. Downstream step waits until all parent dependencies reach terminal status", async () => {
    const wf = createWorkflow({
      id: "wf_wait_all_deps",
      name: "Wait All Deps",
      steps: [
        { id: "dep1", name: "Dep 1", type: "ACTION", input: { actionName: "d1" } },
        { id: "dep2", name: "Dep 2", type: "ACTION", input: { actionName: "d2" } },
        {
          id: "downstream",
          name: "Downstream",
          type: "ACTION",
          dependsOn: ["dep1", "dep2"],
          input: { actionName: "down" },
        },
      ],
    });

    await startWorkflow(wf.id);
    await executeNextStep(wf.id, "dep1");

    // Only dep1 complete, dep2 pending -> downstream should NOT be executable yet
    const wfMid = getWorkflow(wf.id)!;
    const ready = getExecutableSteps(wfMid);
    expect(ready.length).toBe(1);
    expect(ready[0].id).toBe("dep2");
    deleteWorkflow(wf.id);
  });

  test("16. DAG evaluator getExecutableSteps returns only PENDING ready steps", () => {
    const wf = createWorkflow({
      id: "wf_eval_ready",
      name: "Eval Ready",
      steps: [
        { id: "s1", name: "S1", type: "ACTION", input: { actionName: "s1" } },
        { id: "s2", name: "S2", type: "ACTION", dependsOn: ["s1"], input: { actionName: "s2" } },
      ],
    });

    const readyBefore = getExecutableSteps(wf);
    expect(readyBefore.length).toBe(1);
    expect(readyBefore[0].id).toBe("s1");
    deleteWorkflow(wf.id);
  });

  test("17. DAG evaluator validateDag passes clean non-cyclic graph", () => {
    const wf = createWorkflow({
      id: "wf_clean_dag",
      name: "Clean DAG",
      steps: [
        { id: "n1", name: "N1", type: "ACTION", input: { actionName: "1" } },
        { id: "n2", name: "N2", type: "ACTION", dependsOn: ["n1"], input: { actionName: "2" } },
      ],
    });

    let threw = false;
    try {
      validateDag(wf);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    deleteWorkflow(wf.id);
  });

  test("18. Backward compatibility: Linear step arrays without dependsOn execute sequentially", async () => {
    const executed: string[] = [];
    const wf = createWorkflow({
      id: "wf_legacy_linear",
      name: "Legacy Linear",
      steps: [
        { id: "step1", name: "Step 1", type: "ACTION", input: { actionFn: () => executed.push("1") } },
        { id: "step2", name: "Step 2", type: "ACTION", input: { actionFn: () => executed.push("2") } },
        { id: "step3", name: "Step 3", type: "ACTION", input: { actionFn: () => executed.push("3") } },
      ],
    });

    await startWorkflow(wf.id);
    const done = await executeAllSteps(wf.id);

    expect(done.status).toBe("COMPLETED");
    expect(executed).toEqual(["1", "2", "3"]);
    deleteWorkflow(wf.id);
  });
});
