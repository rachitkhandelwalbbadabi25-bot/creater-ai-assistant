// ════════════════════════════════════════════════════════════════════════════════
// src/proactive/scheduler.ts — Cron-based proactive task scheduler
// ════════════════════════════════════════════════════════════════════════════════

import cron, { type ScheduledTask } from "node-cron";
import { env } from "@config/index.js";
import { generateMorningBriefing } from "./briefing.js";
import { generateNightCheck } from "./nightCheck.js";
import { checkDeadlines, checkBatteryAlert, checkLateNightAlert } from "./alerts.js";
import { runMemoryMaintenance } from "@memory/summarizer.js";
import { archiveStaleNodes } from "@memory/graph.js";
import { persistLearnedPatterns } from "@emotion/learner.js";
import { createLogger } from "@utils/logger.js";
import { ENABLE_PROACTIVE_RUNTIME, logRuntimeFeatureFlags } from "../runtime/featureFlags.js";

const log = createLogger("proactive/scheduler");

const jobs: ScheduledTask[] = [];
let schedulerStarted = false;

/**
 * Start all proactive scheduled jobs.
 * Each job runs a specific task at a cron-defined interval.
 */
export function startScheduler(): void {
  logRuntimeFeatureFlags();
  console.log("[AUTOMATION INIT]", "src/proactive/scheduler.ts", "startScheduler");
  console.log("[BACKGROUND TASK]", "src/proactive/scheduler.ts", "scheduler");
  if (schedulerStarted) {
    log.info("Proactive scheduler is already running");
    return;
  }

  if (!ENABLE_PROACTIVE_RUNTIME) {
    log.info("Proactive scheduler disabled by runtime feature flag");
    console.log("PROACTIVE SYSTEMS DISABLED");
    return;
  }

  if (!env.PROACTIVE_ENABLED) {
    log.info("Proactive scheduler is disabled");
    return;
  }

  log.info("Starting proactive scheduler...");
  schedulerStarted = true;

  // 1. Morning briefing
  jobs.push(
    cron.schedule(env.MORNING_BRIEFING_CRON, async () => {
      log.info("⏰ Running morning briefing");
      try { await generateMorningBriefing(); }
      catch (e) { log.error("Morning briefing failed", e); }
    }, { timezone: env.USER_TIMEZONE })
  );

  // 2. Night check-in
  jobs.push(
    cron.schedule(env.NIGHT_CHECK_CRON, async () => {
      log.info("🌙 Running night check-in");
      try { await generateNightCheck(); }
      catch (e) { log.error("Night check failed", e); }
    }, { timezone: env.USER_TIMEZONE })
  );

  // 3. Deadline alerts
  jobs.push(
    cron.schedule(env.DEADLINE_CHECK_CRON, async () => {
      log.info("📋 Checking deadlines");
      try { await checkDeadlines(); }
      catch (e) { log.error("Deadline check failed", e); }
    }, { timezone: env.USER_TIMEZONE })
  );

  // 4. Battery monitoring (every 30 mins)
  jobs.push(
    cron.schedule("*/30 * * * *", async () => {
      try { await checkBatteryAlert(); }
      catch (e) { log.error("Battery check failed", e); }
    }, { timezone: env.USER_TIMEZONE })
  );

  // 5. Late night health check (every hour)
  jobs.push(
    cron.schedule("0 * * * *", () => {
      try { checkLateNightAlert(); }
      catch (e) { log.error("Late night check failed", e); }
    }, { timezone: env.USER_TIMEZONE })
  );

  // 6. Memory maintenance (every 2 hours)
  jobs.push(
    cron.schedule("0 */2 * * *", async () => {
      log.info("🧠 Running memory maintenance");
      try { await runMemoryMaintenance(); }
      catch (e) { log.error("Memory maintenance failed", e); }
    }, { timezone: env.USER_TIMEZONE })
  );

  // 8. Graph maintenance (every 4 hours)
  jobs.push(
    cron.schedule("0 */4 * * *", () => {
      log.info("🕸️ Running graph archival");
      try { archiveStaleNodes(); }
      catch (e) { log.error("Graph archival failed", e); }
    }, { timezone: env.USER_TIMEZONE })
  );

  log.info(`Scheduler started with ${jobs.length} jobs`);
}

export function stopScheduler(): void {
  for (const job of jobs) job.stop();
  jobs.length = 0;
  schedulerStarted = false;
  log.info("Scheduler stopped");
}
