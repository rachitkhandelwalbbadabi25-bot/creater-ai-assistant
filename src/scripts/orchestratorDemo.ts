// src/scripts/orchestratorDemo.ts

/**
 * Demo script for the orchestrator runtime.
 *
 * - Creates several workflows using the dummy MCP client.
 * - Queues them via `executeWorkflow`.
 * - Cancels one workflow mid‑execution.
 * - Prints health snapshots and workflow status transitions.
 * - Writes a consolidated JSON report to `data/demo-output.json`.
 */

import path from "path";
import fs from "fs";
import {
  executeWorkflow,
  cancelWorkflow,
  getActiveWorkflows,
  getQueuedWorkflows,
} from "../orchestrator/internalOrchestrator.js";
import { getOrchestratorHealth } from "../orchestrator/health.js";
import { WorkflowDefinition } from "../orchestrator/types.js";
import * as dummy from "../mcp/dummy/dummyClient.js";

// Helper to pause for a given number of milliseconds
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function runDemo() {
  const workflowResults: any[] = [];

  // ------------------------------------------------------------
  // Workflow A – simple echo (should succeed quickly)
  // ------------------------------------------------------------
  const wfA: WorkflowDefinition = {
    taskId: "wfA",
    name: "Echo Workflow",
    steps: [
      {
        id: "step1",
        agent: "dummy",
        action: "echo",
        args: { message: "Hello from wfA" },
      },
    ],
  };
  const pA = executeWorkflow(wfA).then((res) => workflowResults.push(res)).catch((e) => workflowResults.push({ error: e }));

  // ------------------------------------------------------------
  // Workflow B – slow step, will be cancelled
  // ------------------------------------------------------------
  const wfB: WorkflowDefinition = {
    taskId: "wfB",
    name: "Cancellable Slow Workflow",
    steps: [
      {
        id: "step1",
        agent: "dummy",
        action: "slow",
        args: { delay: 200 }, // 200ms work
      },
    ],
  };
  const pB = executeWorkflow(wfB).then((res) => workflowResults.push(res)).catch((e) => workflowResults.push({ error: e }));

  // Cancel wfB after 30ms (deterministic as per requirements)
  setTimeout(() => {
    void cancelWorkflow("wfB");
  }, 30);

  // ------------------------------------------------------------
  // Workflow C – includes a compensation step that fails
  // ------------------------------------------------------------
  const wfC: WorkflowDefinition = {
    taskId: "wfC",
    name: "Compensation Failure Workflow",
    steps: [
      {
        id: "step1",
        agent: "dummy",
        action: "fail",
        args: {},
        compensate: {
          id: "comp1",
          agent: "dummy",
          action: "fail",
          args: {},
        },
      },
    ],
  };
  const pC = executeWorkflow(wfC).then((res) => workflowResults.push(res)).catch((e) => workflowResults.push({ error: e }));

  // Wait for all workflows to settle
  await Promise.allSettled([pA, pB, pC]);

  // ------------------------------------------------------------
  // Gather health snapshot and final queue state
  // ------------------------------------------------------------
  const health = getOrchestratorHealth();
  const active = getActiveWorkflows();
  const queued = getQueuedWorkflows();

  // ------------------------------------------------------------
  // Write demo output JSON
  // ------------------------------------------------------------
  const output = {
    workflowResults,
    health: { ...health, activeWorkflows: active, queuedWorkflows: queued },
    metrics: {}, // placeholder for future metrics
    artifacts: workflowResults.flatMap((r: any) => r?.artifacts ?? []),
    timestamp: new Date().toISOString(),
  };

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const outPath = path.join(dataDir, "demo-output.json");
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), "utf-8");

  // Log a concise summary for the console
  console.log("Demo completed. Health snapshot:", health);
  console.log("Results written to", outPath);
}

void runDemo();
