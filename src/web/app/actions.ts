"use server";

import { processMessage } from "@graph/supervisor.js";
import { getAppStats } from "@utils/stats.js";
import { getSystemInfo } from "@tools/laptop/system.js";
import { db } from "@memory/db.js";
import { env } from "@config/index.js";

/**
 * Sends a message to the AI supervisor and returns the final response.
 */
export async function chatAction(message: string) {
  try {
    const response = await processMessage(message, "web");
    return { success: true, response };
  } catch (error: any) {
    console.error("Chat Action Error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Fetches current system metrics and app stats.
 */
export async function getStatusAction() {
  try {
    const [systemInfo, appStats] = await Promise.all([
      getSystemInfo(),
      getAppStats(),
    ]);

    return {
      success: true,
      data: {
        system: systemInfo,
        stats: appStats,
      },
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Fetches long-term memories (facts) with optional search.
 */
export async function getMemoriesAction(query?: string) {
  try {
    let sql = "SELECT * FROM facts";
    const params: any[] = [];

    if (query) {
      sql += " WHERE value LIKE ? OR category LIKE ? OR key LIKE ?";
      const p = `%${query}%`;
      params.push(p, p, p);
    }

    sql += " ORDER BY updated_at DESC LIMIT 100";
    const rows = db.prepare(sql).all(...params);
    return { success: true, data: rows };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Fetches analytics data: mood trends and activity.
 */
export async function getAnalyticsAction() {
  try {
    // 1. Mood Trends (last 7 days)
    const moodRows = db.prepare(`
      SELECT mood, created_at 
      FROM emotion_log 
      WHERE created_at >= date('now', '-7 days')
      ORDER BY created_at ASC
    `).all();

    // 2. Activity (messages per day for last 7 days)
    const activityRows = db.prepare(`
      SELECT date(created_at) as date, COUNT(*) as count
      FROM messages
      WHERE created_at >= date('now', '-7 days')
      GROUP BY date(created_at)
      ORDER BY date ASC
    `).all();

    return {
      success: true,
      data: {
        moods: moodRows,
        activity: activityRows,
      }
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * Updates application settings.
 */
export async function updateSettingsAction(settings: any) {
  try {
    // In a real app, you might save these to a config file or DB.
    // For now, we'll return success to simulate the state update.
    console.log("Updating settings:", settings);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
