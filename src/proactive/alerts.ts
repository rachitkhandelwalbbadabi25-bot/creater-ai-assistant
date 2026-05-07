// ════════════════════════════════════════════════════════════════════════════════
// src/proactive/alerts.ts — Deadline and reminder alert system
// ════════════════════════════════════════════════════════════════════════════════

import { db } from "@memory/db.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("proactive/alerts");

let alertCallback: ((message: string) => void) | null = null;

export function onAlertReady(cb: (message: string) => void): void {
  alertCallback = cb;
}

const upcomingTasksStmt = db.prepare(`
  SELECT * FROM tasks
  WHERE status IN ('pending', 'in_progress')
    AND due_date IS NOT NULL
    AND due_date <= datetime('now', '+24 hours')
  ORDER BY due_date ASC
`);

const overdueTasksStmt = db.prepare(`
  SELECT * FROM tasks
  WHERE status IN ('pending', 'in_progress')
    AND due_date IS NOT NULL
    AND due_date < datetime('now')
  ORDER BY due_date ASC
`);

export async function checkDeadlines(): Promise<void> {
  const upcoming = upcomingTasksStmt.all() as Array<{ title: string; due_date: string; priority: string }>;
  const overdue = overdueTasksStmt.all() as Array<{ title: string; due_date: string; priority: string }>;

  if (overdue.length > 0) {
    const msg = `🚨 **Overdue Tasks:**\n${overdue.map(t => `  ❌ ${t.title} (due: ${t.due_date}) [${t.priority}]`).join("\n")}`;
    log.warn(`${overdue.length} overdue tasks found`);
    if (alertCallback) alertCallback(msg);
  }

  if (upcoming.length > 0) {
    const msg = `⏰ **Due in 24 hours:**\n${upcoming.map(t => `  📌 ${t.title} (due: ${t.due_date})`).join("\n")}`;
    log.info(`${upcoming.length} upcoming deadlines`);
    if (alertCallback) alertCallback(msg);
  }
}
