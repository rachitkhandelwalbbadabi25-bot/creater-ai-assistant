import { describe, it, expect, beforeEach } from "bun:test";
import { tracer } from "../src/monitoring/tracer.js";
import { workflowReplayManager } from "../src/monitoring/workflowReplay.js";
import { getSchedulerMetrics, evaluateSchedulerHealth } from "../src/monitoring/schedulerMonitor.js";
import { getHealthStatus } from "../src/monitoring/health.js";
import { getDashboard } from "../src/monitoring/dashboard.js";
import { dispatchTool } from "../src/tools/dispatcher.js";
import { createWorkflow, executeAllSteps, getWorkflow } from "../src/workflow/workflowEngine.js";
import { createSchedule, listSchedules, deleteSchedule, clearClaimedOccurrences, start, stop } from "../src/scheduler/schedulerEngine.js";

function clearSchedules() {
  for (const s of listSchedules()) {
    deleteSchedule(s.id);
  }
  clearClaimedOccurrences();
}

describe("Phase 7: Monitoring & Background Jobs", () => {
  beforeEach(() => {
    tracer.clear();
    workflowReplayManager.clear();
    clearSchedules();
  });

  describe("Unified Execution Tracer & Spans", () => {
    it("creates root traces and tracks child spans with duration and status", () => {
      const trace = tracer.startTrace("test_root_operation", { userId: "user-123" });
      expect(trace.id).toBeDefined();
      expect(trace.rootName).toBe("test_root_operation");
      expect(trace.status).toBe("running");

      const span1 = tracer.startSpan(trace.id, "parse_input", "system");
      expect(span1.id).toBeDefined();
      expect(span1.status).toBe("running");

      const endedSpan1 = tracer.endSpan(span1.id, { parsed: true });
      expect(endedSpan1?.status).toBe("completed");
      expect(endedSpan1?.durationMs).toBeGreaterThanOrEqual(0);

      const span2 = tracer.startSpan(trace.id, "execute_action", "tool", span1.id);
      expect(span2.parentSpanId).toBe(span1.id);

      const endedSpan2 = tracer.endSpan(span2.id, undefined, new Error("Execution timed out"));
      expect(endedSpan2?.status).toBe("failed");
      expect(endedSpan2?.error).toContain("timed out");

      const endedTrace = tracer.endTrace(trace.id);
      expect(endedTrace?.status).toBe("failed"); // should detect child span failure
      expect(endedTrace?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("runs scoped async blocks with ambient trace context and auto-parenting", async () => {
      const trace = tracer.startTrace("scoped_parent");
      let capturedSpanId: string | undefined;

      await tracer.runWithContext({ traceId: trace.id }, async () => {
        const result = await tracer.trace(
          "inner_child_op",
          "model",
          async (span) => {
            capturedSpanId = span.id;
            return { answer: "success" };
          },
          { model: "primary" }
        );

        expect(result.answer).toBe("success");
      });

      tracer.endTrace(trace.id, "completed");

      const retrieved = tracer.getTrace(trace.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.spans.length).toBe(1);
      expect(retrieved?.spans[0].id).toBe(capturedSpanId!);
      expect(retrieved?.spans[0].status).toBe("completed");
    });

    it("formats human-readable ASCII timeline for terminal debugging", () => {
      const trace = tracer.startTrace("cli_request", {}, "tr_ascii_test");
      const s1 = tracer.startSpan(trace.id, "intent_detection", "agent");
      tracer.endSpan(s1.id, { intent: "SYSTEM_CONTROL" });

      const s2 = tracer.startSpan(trace.id, "system.volume", "tool", s1.id);
      tracer.endSpan(s2.id, { volume: 70 });

      tracer.endTrace(trace.id, "completed");

      const timeline = tracer.formatTraceTimeline("tr_ascii_test");
      expect(timeline).toContain("Trace: cli_request [tr_ascii_test] (COMPLETED)");
      expect(timeline).toContain("[AGENT] intent_detection: ✓");
      expect(timeline).toContain("└─ [TOOL] system.volume: ✓");
    });
  });

  describe("Automatic Tool Dispatch Tracing", () => {
    it("records a tool span inside active trace context", async () => {
      const rootTrace = tracer.startTrace("user_query_flow");

      await tracer.runWithContext({ traceId: rootTrace.id }, async () => {
        const info = (await dispatchTool("system.info", {})) as any;
        expect(info).toBeDefined();
        expect(info.os).toBeDefined();
      });

      tracer.endTrace(rootTrace.id, "completed");

      const trace = tracer.getTrace(rootTrace.id);
      expect(trace).toBeDefined();
      const toolSpan = trace?.spans.find((s) => s.name === "tool:system.info");
      expect(toolSpan).toBeDefined();
      expect(toolSpan?.type).toBe("tool");
      expect(toolSpan?.status).toBe("completed");
    });

    it("captures tool failures as failed spans", async () => {
      const rootTrace = tracer.startTrace("failing_tool_flow");

      await tracer.runWithContext({ traceId: rootTrace.id }, async () => {
        try {
          // Read a nonexistent file
          await dispatchTool("fs.read_file", { path: "Z:/nonexistent_dummy_file_path_12345.txt" });
        } catch {
          // Expected to fail
        }
      });

      tracer.endTrace(rootTrace.id);

      const trace = tracer.getTrace(rootTrace.id);
      expect(trace).toBeDefined();
      const failedSpan = trace?.spans.find((s) => s.name === "tool:fs.read_file");
      expect(failedSpan).toBeDefined();
      expect(failedSpan?.status).toBe("failed");
      expect(failedSpan?.error).toBeDefined();
    });
  });

  describe("System Diagnostics & Trace Inspection Tools", () => {
    it("system.diagnostics returns unified dashboard with scheduler & traces", async () => {
      const dashboard = (await dispatchTool("system.diagnostics", {})) as any;
      expect(dashboard).toBeDefined();
      expect(dashboard.health).toBeDefined();
      expect(dashboard.metrics.scheduler).toBeDefined();
      expect(Array.isArray(dashboard.recentTraces)).toBe(true);
    });

    it("system.traces lists recent traces and outputs detailed timeline", async () => {
      const t1 = tracer.startTrace("test_query_1");
      tracer.endTrace(t1.id, "completed");

      const listResult = (await dispatchTool("system.traces", { limit: 5 })) as any;
      expect(listResult.traces).toBeDefined();
      expect(listResult.traces.length).toBeGreaterThan(0);

      const timelineResult = (await dispatchTool("system.traces", { traceId: t1.id })) as any;
      expect(timelineResult.trace).toBeDefined();
      expect(timelineResult.timeline).toContain("test_query_1");
    });
  });

  describe("Background Scheduler Telemetry & Health Monitoring", () => {
    it("calculates scheduler metrics and detects active jobs", () => {
      createSchedule({
        name: "Test Job 1",
        schedule: {
          type: "CRON",
          cronExpression: "0 * * * *",
        },
        workflowId: "wf_test_1",
      });
      stop(); // Stop loop while job is ACTIVE

      const metrics = getSchedulerMetrics();
      expect(metrics.activeJobs).toBe(1);
      expect(metrics.loopRunning).toBe(false);

      // Loop stopped with active job triggers health deduction
      const evaluation = evaluateSchedulerHealth();
      expect(evaluation.scoreDeduction).toBeGreaterThanOrEqual(25);
      expect(evaluation.issues.some((i) => i.includes("Scheduler loop is stopped"))).toBe(true);
    });

    it("detects overdue/missed occurrences", () => {
      const pastTime = Date.now() - 120000; // 2 minutes in past
      createSchedule({
        name: "Overdue Reminder",
        schedule: {
          type: "ONCE",
          runAt: pastTime,
        },
        workflowId: "wf_test_2",
      });
      stop();

      const metrics = getSchedulerMetrics();
      expect(metrics.missedOccurrences).toBeGreaterThan(0);

      const evaluation = evaluateSchedulerHealth();
      expect(evaluation.issues.some((i) => i.includes("Overdue background schedules"))).toBe(true);
    });

    it("integrates scheduler health into system health status score", async () => {
      start();
      const healthBefore = await getHealthStatus();

      createSchedule({
        name: "Job with stopped loop",
        schedule: {
          type: "CRON",
          cronExpression: "0 0 * * *",
        },
        workflowId: "wf_test_3",
      });
      stop(); // Stop loop after creating active job to trigger health score degradation

      const healthAfter = await getHealthStatus();
      expect(healthAfter.details.some((d) => d.includes("Scheduler loop is stopped"))).toBe(true);
      expect(healthAfter.score).toBeLessThan(healthBefore.score);
    });
  });

  describe("Workflow State Snapshots & Replay Engine", () => {
    it("captures snapshots during workflow execution and replays deterministically from a step", async () => {
      let step1Executions = 0;
      let step2Executions = 0;
      let step3Executions = 0;

      const wf = createWorkflow({
        name: "Test Replay Flow",
        steps: [
          {
            id: "step_init",
            name: "Initialize Setup",
            type: "ACTION",
            input: {
              actionFn: async () => {
                step1Executions++;
                return { baseVal: 100 };
              },
            },
          },
          {
            id: "step_mid",
            name: "Mid Compute",
            type: "ACTION",
            input: {
              actionFn: async () => {
                step2Executions++;
                return { midVal: 200 };
              },
            },
          },
          {
            id: "step_final",
            name: "Final Step",
            type: "ACTION",
            input: {
              actionFn: async () => {
                step3Executions++;
                return { finalVal: 300 };
              },
            },
          },
        ],
      });

      // 1. Initial run
      const executed = await executeAllSteps(wf.id);
      expect(executed.status).toBe("COMPLETED");
      expect(step1Executions).toBe(1);
      expect(step2Executions).toBe(1);
      expect(step3Executions).toBe(1);

      // Verify snapshots were automatically captured
      const snapshots = workflowReplayManager.getSnapshots(wf.id);
      expect(snapshots.length).toBe(3);
      expect(snapshots[0].stepId).toBe("step_init");
      expect(snapshots[1].stepId).toBe("step_mid");
      expect(snapshots[2].stepId).toBe("step_final");

      // 2. Replay from step_mid
      const replayResult = await workflowReplayManager.replayWorkflow(wf.id, {
        fromStepId: "step_mid",
      });

      expect(replayResult.success).toBe(true);
      expect(replayResult.replayedFromStep).toBe("step_mid");

      // step 1 should NOT re-run, but step 2 and step 3 should re-run!
      expect(step1Executions).toBe(1); // Not executed again
      expect(step2Executions).toBe(2); // Re-executed
      expect(step3Executions).toBe(2); // Re-executed

      // 3. Verify workflow.replay tool works via dispatcher
      const toolReplayResult = (await dispatchTool("workflow.replay", {
        workflowId: wf.id,
        fromStepId: "step_final",
      })) as any;

      expect(toolReplayResult.success).toBe(true);
      expect(step1Executions).toBe(1);
      expect(step2Executions).toBe(2);
      expect(step3Executions).toBe(3);
    });
  });
});
