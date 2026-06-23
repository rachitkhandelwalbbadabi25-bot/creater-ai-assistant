// ════════════════════════════════════════════════════════════════════════════════
// src/proactive/alerts.ts — Deadline and reminder alert system
// ════════════════════════════════════════════════════════════════════════════════

import { getDB } from "@memory/db.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("proactive/alerts");

let alertCallback: ((message: string) => void) | null = null;

export function onAlertReady(cb: (message: string) => void): void {
  alertCallback = cb;
}

let preparedStatements: {
  upcomingTasksStmt: any;
  overdueTasksStmt: any;
} | undefined;

function statements() {
  if (!preparedStatements) {
    const db = getDB();
    preparedStatements = {
      upcomingTasksStmt: db.prepare(`
        SELECT * FROM tasks
        WHERE status IN ('pending', 'in_progress')
          AND due_date IS NOT NULL
          AND due_date <= datetime('now', '+24 hours')
        ORDER BY due_date ASC
      `),
      overdueTasksStmt: db.prepare(`
        SELECT * FROM tasks
        WHERE status IN ('pending', 'in_progress')
          AND due_date IS NOT NULL
          AND due_date < datetime('now')
        ORDER BY due_date ASC
      `),
    };
  }
  return preparedStatements;
}

export async function checkDeadlines(): Promise<void> {
  const upcoming = statements().upcomingTasksStmt.all() as Array<{ title: string; due_date: string; priority: string }>;
  const overdue = statements().overdueTasksStmt.all() as Array<{ title: string; due_date: string; priority: string }>;

  if (overdue.length > 0) {
    const msg = `🚨 **Overdue Tasks:**\n${overdue.map(t => `  ❌ ${t.title} (due: ${t.due_date}) [${t.priority}]`).join("\n")}`;
    if (alertCallback) alertCallback(msg);
  }

  if (upcoming.length > 0) {
    const msg = `⏰ **Due in 24 hours:**\n${upcoming.map(t => `  📌 ${t.title} (due: ${t.due_date})`).join("\n")}`;
    if (alertCallback) alertCallback(msg);
  }
}

/**
 * Check for low battery and notify the user.
 */
export async function checkBatteryAlert(): Promise<void> {
  try {
    const { getSystemInfo } = await import("@tools/laptop/system.js");
    const sys = await getSystemInfo();
    
    if (sys.battery && sys.battery.percent < 20 && !sys.battery.charging) {
      const msg = `🪫 **Low Battery Alert:** Your laptop is at ${sys.battery.percent}%. Please plug in the charger soon!`;
      if (alertCallback) alertCallback(msg);
    }
  } catch (e) {
    log.error("Battery check failed", e);
  }
}

/**
 * Check if it's late night and suggest the user to rest.
 */
export function checkLateNightAlert(): void {
  const hour = new Date().getHours();
  if (hour >= 23 || hour <= 4) {
    const msg = "🌙 **Late Night Alert:** It's getting late. Make sure to get some rest! I'm here if you need me, but sleep is important.";
    if (alertCallback) alertCallback(msg);
  }
}
