import { db } from "@memory/db.js";
import { getMessageCount } from "@memory/shortTerm.js";

export interface AppStats {
  messageCount: number;
  factCount: number;
  taskCount: number;
  lastMood: string;
}

/**
 * Fetch current assistant stats for TUI display.
 */
export function getAppStats(): AppStats {
  try {
    const factResult = db.prepare("SELECT COUNT(*) as count FROM facts").get() as { count: number };
    const taskResult = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status != 'done'").get() as { count: number };
    const moodResult = db.prepare("SELECT mood FROM emotion_log ORDER BY created_at DESC LIMIT 1").get() as { mood: string };

    return {
      messageCount: getMessageCount(),
      factCount: factResult?.count ?? 0,
      taskCount: taskResult?.count ?? 0,
      lastMood: moodResult?.mood ?? "Neutral",
    };
  } catch {
    return {
      messageCount: 0,
      factCount: 0,
      taskCount: 0,
      lastMood: "Stable",
    };
  }
}
