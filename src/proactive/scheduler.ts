// ════════════════════════════════════════════════════════════════════════════════
// src/proactive/scheduler.ts — Cron-based proactive task scheduler
// ════════════════════════════════════════════════════════════════════════════════

import cron from "node-cron";
import { env } from "@config/index.js";
import { generateMorningBriefing } from "./briefing.js";
import { generateNightCheck } from "./nightCheck.js";
import { checkDeadlines } from "./alerts.js";
import { runMemoryMaintenance } from "@memory/summarizer.js";
import { persistLearnedPatterns } from "@emotion/learner.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("proactive/scheduler");

const jobs: cron.ScheduledTask[] = [];

/**
 * Start all proactive scheduled jobs.
 * Each job runs a specific task at a cron-defined interval.
 */
export function startScheduler(): void {
  if (!env.PROACTIVE_ENABLED) {
    log.info("Proactive scheduler is disabled");
    return;
  }

  log.info("Starting proactive scheduler...");

  // Morning briefing
  jobs.push(
    cron.schedule(env.MORNING_BRIEFING_CRON, async () => {
      log.info("⏰ Running morning briefing");
      try { await generateMorningBriefing(); }
      catch (e) { log.error("Morning briefing failed", e); }
    }, { timezone: env.USER_TIMEZONE })
  );

  // Night check-in
  jobs.push(
    cron.schedule(env.NIGHT_CHECK_CRON, async () => {
      log.info("🌙 Running night check-in");
      try { await generateNightCheck(); }
      catch (e) { log.error("Night check failed", e); }
    }, { timezone: env.USER_TIMEZONE })
  );

  // Deadline alerts
  jobs.push(
    cron.schedule(env.DEADLINE_CHECK_CRON, async () => {
      log.info("📋 Checking deadlines");
      try { await checkDeadlines(); }
      catch (e) { log.error("Deadline check failed", e); }
    }, { timezone: env.USER_TIMEZONE })
  );

  // Memory maintenance (every 2 hours)
  jobs.push(
    cron.schedule("0 */2 * * *", async () => {
      log.info("🧠 Running memory maintenance");
      try { await runMemoryMaintenance(); }
      catch (e) { log.error("Memory maintenance failed", e); }
    }, { timezone: env.USER_TIMEZONE })
  );

  // Emotion pattern learning (daily at 2 AM)
  jobs.push(
    cron.schedule("0 2 * * *", () => {
      log.info("📊 Learning emotion patterns");
      try { persistLearnedPatterns(); }
      catch (e) { log.error("Emotion learning failed", e); }
    }, { timezone: env.USER_TIMEZONE })
  );

  log.info(`Scheduler started with ${jobs.length} jobs`);
}

export function stopScheduler(): void {
  for (const job of jobs) job.stop();
  jobs.length = 0;
  log.info("Scheduler stopped");
}
