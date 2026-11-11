// ════════════════════════════════════════════════════════════════════════════════
// tests/workflowBranching.test.ts — Workflow Dynamic Branching Test Suite
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
import { WorkflowError } from "../src/workflow/types.js";

describe("Workflow Dynamic Branching Suite", () => {
  beforeEach(() => {
    clearActiveClaims();
  });

  test("1. Executes TRUE branch (thenStepId) and skips elseStepId", async () => {
    const wf = createWorkflow({
      id: "wf_branch_true",
      name: "Branch True Test",
      steps: [
        {
          id: "branch_node",
          name: "Evaluate Condition",
          type: "BRANCH",
          input: {
            conditionFn: () => true,
            thenStepId: "step_true",
            elseStepId: "step_false",
          },
        },
        {
          id: "step_true",
          name: "True Path Execution",
          type: "ACTION",
          dependsOn: ["branch_node"],
          input: { actionName: "true_action" },
        },
        {
          id: "step_false",
          name: "False Path Execution",
          type: "ACTION",
          dependsOn: ["branch_node"],
          input: { actionName: "false_action" },
        },
      ],
    });

    await startWorkflow(wf.id);
    const completedWf = await executeAllSteps(wf.id);

    expect(completedWf.status).toBe("COMPLETED");
    const branchStep = completedWf.steps.find((s) => s.id === "branch_node");
    const trueStep = completedWf.steps.find((s) => s.id === "step_true");
    const falseStep = completedWf.steps.find((s) => s.id === "step_false");

    expect(branchStep?.status).toBe("COMPLETED");
    expect(trueStep?.status).toBe("COMPLETED");
    expect(falseStep?.status).toBe("SKIPPED");
    deleteWorkflow(wf.id);
  });

  test("2. Executes FALSE branch (elseStepId) and skips thenStepId", async () => {
    const wf = createWorkflow({
      id: "wf_branch_false",
      name: "Branch False Test",
      steps: [
        {
          id: "branch_node",
          name: "Evaluate Condition",
          type: "BRANCH",
          input: {
            conditionFn: () => false,
            thenStepId: "step_true",
            elseStepId: "step_false",
          },
        },
        {
          id: "step_true",
          name: "True Path Execution",
          type: "ACTION",
          dependsOn: ["branch_node"],
          input: { actionName: "true_action" },
        },
        {
          id: "step_false",
          name: "False Path Execution",
          type: "ACTION",
          dependsOn: ["branch_node"],
          input: { actionName: "false_action" },
        },
      ],
    });

    await startWorkflow(wf.id);
    const completedWf = await executeAllSteps(wf.id);

    expect(completedWf.status).toBe("COMPLETED");
    const trueStep = completedWf.steps.find((s) => s.id === "step_true");
    const falseStep = completedWf.steps.find((s) => s.id === "step_false");

    expect(trueStep?.status).toBe("SKIPPED");
    expect(falseStep?.status).toBe("COMPLETED");
    deleteWorkflow(wf.id);
  });

  test("3. Shared downstream merge node executes after active branch completes", async () => {
    const wf = createWorkflow({
      id: "wf_branch_merge",
      name: "Branch Merge Test",
      steps: [
        {
          id: "branch_node",
          name: "Choose Branch",
          type: "BRANCH",
          input: {
            conditionFn: () => true,
            thenStepId: "path_a",
            elseStepId: "path_b",
          },
        },
        {
          id: "path_a",
          name: "Path A",
          type: "ACTION",
          dependsOn: ["branch_node"],
          input: { actionName: "do_a" },
        },
        {
          id: "path_b",
          name: "Path B",
          type: "ACTION",
          dependsOn: ["branch_node"],
          input: { actionName: "do_b" },
        },
        {
          id: "merge_node",
          name: "Final Merge",
          type: "ACTION",
          dependsOn: ["path_a", "path_b"],
          input: { actionName: "do_merge" },
        },
      ],
    });

    await startWorkflow(wf.id);
    const completedWf = await executeAllSteps(wf.id);

    expect(completedWf.status).toBe("COMPLETED");
    const pathA = completedWf.steps.find((s) => s.id === "path_a");
    const pathB = completedWf.steps.find((s) => s.id === "path_b");
    const merge = completedWf.steps.find((s) => s.id === "merge_node");

    expect(pathA?.status).toBe("COMPLETED");
    expect(pathB?.status).toBe("SKIPPED");
    expect(merge?.status).toBe("COMPLETED");
    deleteWorkflow(wf.id);
  });

  test("4. Throws validation error if thenStepId references non-existent step", () => {
    expect(() => {
      createWorkflow({
        id: "wf_invalid_then",
        name: "Invalid Then Step",
        steps: [
          {
            id: "branch_node",
            name: "Branch",
            type: "BRANCH",
            input: {
              thenStepId: "non_existent_id",
            },
          },
        ],
      });
    }).toThrow(WorkflowError);
  });

  test("5. Throws validation error if elseStepId references non-existent step", () => {
    expect(() => {
      createWorkflow({
        id: "wf_invalid_else",
        name: "Invalid Else Step",
        steps: [
          {
            id: "branch_node",
            name: "Branch",
            type: "BRANCH",
            input: {
              elseStepId: "non_existent_id",
            },
          },
        ],
      });
    }).toThrow(WorkflowError);
  });

  test("6. Branch decision is persisted to stateStore and readable via getWorkflow", async () => {
    const wf = createWorkflow({
      id: "wf_branch_persist",
      name: "Persist Branch Decision",
      steps: [
        {
          id: "branch_step",
          name: "Branch Step",
          type: "BRANCH",
          input: {
            conditionFn: () => true,
            thenStepId: "target_then",
            elseStepId: "target_else",
          },
        },
        {
          id: "target_then",
          name: "Then Target",
          type: "ACTION",
          dependsOn: ["branch_step"],
          input: { actionName: "then" },
        },
        {
          id: "target_else",
          name: "Else Target",
          type: "ACTION",
          dependsOn: ["branch_step"],
          input: { actionName: "else" },
        },
      ],
    });

    await startWorkflow(wf.id);
    await executeNextStep(wf.id, "branch_step");

    const reloaded = getWorkflow(wf.id);
    const branchRes = reloaded?.steps.find((s) => s.id === "branch_step")?.output as any;
    expect(branchRes?.branchResult).toBe(true);
    expect(branchRes?.chosenStepId).toBe("target_then");
    expect(branchRes?.skippedStepId).toBe("target_else");
    deleteWorkflow(wf.id);
  });

  test("7. Evaluates params.condition boolean parameter if conditionFn is omitted", async () => {
    const wf = createWorkflow({
      id: "wf_branch_param_cond",
      name: "Param Condition Branch",
      steps: [
        {
          id: "branch_node",
          name: "Param Branch",
          type: "BRANCH",
          input: {
            params: { condition: false },
            thenStepId: "path_then",
            elseStepId: "path_else",
          },
        },
        {
          id: "path_then",
          name: "Then",
          type: "ACTION",
          dependsOn: ["branch_node"],
          input: { actionName: "then" },
        },
        {
          id: "path_else",
          name: "Else",
          type: "ACTION",
          dependsOn: ["branch_node"],
          input: { actionName: "else" },
        },
      ],
    });

    await startWorkflow(wf.id);
    const completedWf = await executeAllSteps(wf.id);

    expect(completedWf.steps.find((s) => s.id === "path_then")?.status).toBe("SKIPPED");
    expect(completedWf.steps.find((s) => s.id === "path_else")?.status).toBe("COMPLETED");
    deleteWorkflow(wf.id);
  });

  test("8. Recursively skips multi-level unreachable child branches", async () => {
    const wf = createWorkflow({
      id: "wf_branch_deep_skip",
      name: "Deep Skip Test",
      steps: [
        {
          id: "branch_node",
          name: "Branch",
          type: "BRANCH",
          input: {
            conditionFn: () => true,
            thenStepId: "active_path",
            elseStepId: "dead_path_l1",
          },
        },
        {
          id: "active_path",
          name: "Active Path",
          type: "ACTION",
          dependsOn: ["branch_node"],
          input: { actionName: "active" },
        },
        {
          id: "dead_path_l1",
          name: "Dead Path Level 1",
          type: "ACTION",
          dependsOn: ["branch_node"],
          input: { actionName: "dead1" },
        },
        {
          id: "dead_path_l2",
          name: "Dead Path Level 2",
          type: "ACTION",
          dependsOn: ["dead_path_l1"],
          input: { actionName: "dead2" },
        },
      ],
    });

    await startWorkflow(wf.id);
    const completedWf = await executeAllSteps(wf.id);

    expect(completedWf.steps.find((s) => s.id === "dead_path_l1")?.status).toBe("SKIPPED");
    expect(completedWf.steps.find((s) => s.id === "dead_path_l2")?.status).toBe("SKIPPED");
    expect(completedWf.steps.find((s) => s.id === "active_path")?.status).toBe("COMPLETED");
    deleteWorkflow(wf.id);
  });

  test("9. Concurrent step execution during branch evaluation does not corrupt state", async () => {
    const wf = createWorkflow({
      id: "wf_branch_concurrent",
      name: "Concurrent Branch",
      steps: [
        {
          id: "b1",
          name: "Branch 1",
          type: "BRANCH",
          input: { conditionFn: () => true, thenStepId: "t1", elseStepId: "e1" },
        },
        {
          id: "t1",
          name: "Then 1",
          type: "ACTION",
          dependsOn: ["b1"],
          input: { actionName: "t1" },
        },
        {
          id: "e1",
          name: "Else 1",
          type: "ACTION",
          dependsOn: ["b1"],
          input: { actionName: "e1" },
        },
      ],
    });

    await startWorkflow(wf.id);
    const [res1, res2] = await Promise.allSettled([
      executeNextStep(wf.id, "b1"),
      executeNextStep(wf.id, "b1"),
    ]);

    expect(res1.status === "fulfilled" || res2.status === "fulfilled").toBe(true);
    expect(res1.status === "rejected" || res2.status === "rejected").toBe(true);
    deleteWorkflow(wf.id);
  });

  test("10. Branch condition can access context variables dynamically", async () => {
    const wf = createWorkflow({
      id: "wf_branch_vars",
      name: "Branch Context Vars",
      metadata: { variables: { role: "admin" } },
      steps: [
        {
          id: "b1",
          name: "Check Role",
          type: "BRANCH",
          input: {
            conditionFn: (ctx) => ctx.variables.role === "admin",
            thenStepId: "admin_action",
            elseStepId: "user_action",
          },
        },
        {
          id: "admin_action",
          name: "Admin Action",
          type: "ACTION",
          dependsOn: ["b1"],
          input: { actionName: "admin" },
        },
        {
          id: "user_action",
          name: "User Action",
          type: "ACTION",
          dependsOn: ["b1"],
          input: { actionName: "user" },
        },
      ],
    });

    await startWorkflow(wf.id);
    const completed = await executeAllSteps(wf.id);
    expect(completed.steps.find((s) => s.id === "admin_action")?.status).toBe("COMPLETED");
    expect(completed.steps.find((s) => s.id === "user_action")?.status).toBe("SKIPPED");
    deleteWorkflow(wf.id);
  });

  test("11. Branch with missing thenStepId/elseStepId defaults to skipping specified path", async () => {
    const wf = createWorkflow({
      id: "wf_branch_default",
      name: "Branch Default",
      steps: [
        {
          id: "b1",
          name: "Branch 1",
          type: "BRANCH",
          input: { conditionFn: () => true },
        },
      ],
    });

    await startWorkflow(wf.id);
    const completed = await executeAllSteps(wf.id);
    expect(completed.status).toBe("COMPLETED");
    deleteWorkflow(wf.id);
  });

  test("12. Workflow status reaches COMPLETED when branch and downstream steps finish", async () => {
    const wf = createWorkflow({
      id: "wf_branch_finish",
      name: "Finish Workflow",
      steps: [
        {
          id: "b1",
          type: "BRANCH",
          name: "Branch",
          input: { conditionFn: () => false, thenStepId: "t1", elseStepId: "e1" },
        },
        { id: "t1", type: "ACTION", name: "T", dependsOn: ["b1"], input: { actionName: "t" } },
        { id: "e1", type: "ACTION", name: "E", dependsOn: ["b1"], input: { actionName: "e" } },
      ],
    });

    await startWorkflow(wf.id);
    const done = await executeAllSteps(wf.id);
    expect(done.status).toBe("COMPLETED");
    deleteWorkflow(wf.id);
  });
});
