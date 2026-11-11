// ════════════════════════════════════════════════════════════════════════════════
// src/proactive/scheduler.ts — Proactive Task Scheduler Adapter
// Delegates all background jobs to the authoritative SchedulerEngine & WorkflowEngine.
// ════════════════════════════════════════════════════════════════════════════════

import { env } from "@config/index.js";
import { generateMorningBriefing } from "./briefing.js";
import { generateNightCheck } from "./nightCheck.js";
import { checkDeadlines, checkBatteryAlert, checkLateNightAlert } from "./alerts.js";
import { runMemoryMaintenance } from "@memory/summarizer.js";
import { archiveStaleNodes } from "@memory/graph.js";
import { createLogger } from "@utils/logger.js";
import {
  start as startSchedulerEngine,
  stop as stopSchedulerEngine,
  createSchedule,
  getSchedule,
} from "../scheduler/schedulerEngine.js";

const log = createLogger("proactive/scheduler");

/** Proactive job definitions routing through WorkflowEngine */
const PROACTIVE_JOBS = [
  {
    id: "proactive_morning_briefing",
    name: "Morning Briefing",
    cron: env.MORNING_BRIEFING_CRON || "0 8 * * *",
    actionName: "generateMorningBriefing",
    actionFn: async () => { await generateMorningBriefing(); },
  },
  {
    id: "proactive_night_check",
    name: "Night Check-in",
    cron: env.NIGHT_CHECK_CRON || "0 22 * * *",
    actionName: "generateNightCheck",
    actionFn: async () => { await generateNightCheck(); },
  },
  {
    id: "proactive_deadline_check",
    name: "Deadline Alerts",
    cron: env.DEADLINE_CHECK_CRON || "0 9 * * *",
    actionName: "checkDeadlines",
    actionFn: async () => { await checkDeadlines(); },
  },
  {
    id: "proactive_battery_check",
    name: "Battery Monitoring",
    cron: "*/30 * * * *",
    actionName: "checkBatteryAlert",
    actionFn: async () => { await checkBatteryAlert(); },
  },
  {
    id: "proactive_late_night_check",
    name: "Late Night Health Check",
    cron: "0 * * * *",
    actionName: "checkLateNightAlert",
    actionFn: async () => { checkLateNightAlert(); },
  },
  {
    id: "proactive_memory_maintenance",
    name: "Memory Maintenance",
    cron: "0 */2 * * *",
    actionName: "runMemoryMaintenance",
    actionFn: async () => { await runMemoryMaintenance(); },
  },
  {
    id: "proactive_graph_archival",
    name: "Graph Maintenance",
    cron: "0 */4 * * *",
    actionName: "archiveStaleNodes",
    actionFn: async () => { archiveStaleNodes(); },
  },
];

/**
 * Start all proactive scheduled jobs by delegating to the authoritative SchedulerEngine.
 */
export function startScheduler(): void {
  // Always start authoritative SchedulerEngine polling loop so user reminders run
  startSchedulerEngine(1000);

  if (!env.PROACTIVE_ENABLED) {
    log.info("Proactive background recommendations disabled, but SchedulerEngine is active for user reminders.");
    return;
  }

  log.info("Starting proactive scheduler adapter via SchedulerEngine...");

  // Register each proactive job in SchedulerEngine if not already created
  for (const jobDef of PROACTIVE_JOBS) {
    try {
      const existing = getSchedule(jobDef.id);
      if (!existing) {
        createSchedule({
          id: jobDef.id,
          name: jobDef.name,
          schedule: {
            type: "CRON",
            cronExpression: jobDef.cron,
          },
          workflowTemplate: {
            name: `${jobDef.name} Workflow`,
            steps: [
              {
                name: jobDef.name,
                type: "ACTION",
                input: {
                  actionName: jobDef.actionName,
                  actionFn: jobDef.actionFn,
                },
              },
            ],
          },
        });
      }
    } catch (e: any) {
      log.error(`Failed to register proactive job [${jobDef.id}]: ${e.message}`);
    }
  }

  // Start authoritative SchedulerEngine polling loop
  startSchedulerEngine(1000);
  log.info("Proactive scheduler adapter successfully started.");
}

/**
 * Stop proactive scheduler by stopping authoritative SchedulerEngine.
 */
export function stopScheduler(): void {
  stopSchedulerEngine();
  log.info("Proactive scheduler adapter stopped.");
}
