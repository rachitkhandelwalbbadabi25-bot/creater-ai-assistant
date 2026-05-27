"use server";

import os from "os";
import { logRuntimeFeatureFlags } from "../../runtime/featureFlags.js";

async function getDb() {
  const module = await import("@memory/db.js");
  return module.db;
}

/**
 * Sends a message to the AI supervisor and returns the final response.
 */
export async function chatAction(message: string) {
  console.log("[CHAT ACTION START]", { message });
  try {
    logRuntimeFeatureFlags();
    console.log("[ACTIVE RUNTIME PATH]", { channel: "web", entrypoint: "chatAction" });
    console.log("ACTIVE ROUTER MODULE LOADED", "@graph/supervisor.js");
    const { processMessage } = await import("@graph/supervisor.js");
    const response = await processMessage(message, "web");
    return { success: true, response };
  } catch (error: any) {
    console.error("Chat Action Error:", error);
    let errorMessage = error.message;
    if (errorMessage && errorMessage.toLowerCase().includes("not found")) {
      errorMessage = `Model not found error: ${errorMessage}. Please check your model configuration.`;
    }
    return { success: false, error: errorMessage };
  } finally {
    console.log("[CHAT ACTION END]", { message });
  }
}

/**
 * Fetches current system metrics and app stats.
 */
export async function getStatusAction() {
  console.log("[ACTION START]", { action: "getStatusAction" });
  try {
    const { getAppStats } = await import("@utils/stats.js");
    const appStats = getAppStats();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const cpu = os.cpus();

    return {
      success: true,
      data: {
        system: {
          cpu: {
            model: cpu[0]?.model ?? "Unavailable",
            usage: 0,
            cores: cpu.length,
          },
          ram: {
            total: `${Math.round(totalMem / 1024 / 1024 / 1024)} GB`,
            used: `${Math.round((totalMem - freeMem) / 1024 / 1024 / 1024)} GB`,
            usagePercent: totalMem > 0 ? Math.round(((totalMem - freeMem) / totalMem) * 100) : 0,
          },
          battery: null,
          disk: [],
          uptime: `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
          os: `${os.type()} ${os.release()}`,
        },
        stats: appStats,
      },
    };
  } catch (error: any) {
    console.error("[ACTION ERROR]", { action: "getStatusAction", error: error?.message ?? String(error) });
    return {
      success: true,
      data: {
        system: {
          cpu: { model: "Unavailable", usage: 0, cores: 0 },
          ram: { total: "0 B", used: "0 B", usagePercent: 0 },
          battery: null,
          disk: [],
          uptime: "0h 0m",
          os: "Unavailable",
        },
        stats: {
          messageCount: 0,
          factCount: 0,
          taskCount: 0,
          lastMood: "Neutral",
        },
      },
    };
  } finally {
    console.log("[ACTION END]", { action: "getStatusAction" });
  }
}

/**
 * Fetches long-term memories (facts) with optional search.
 */
export async function getMemoriesAction(query?: string) {
  console.log("[ACTION START]", { action: "getMemoriesAction", query });
  try {
    const db = await getDb();
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
  } finally {
    console.log("[ACTION END]", { action: "getMemoriesAction", query });
  }
}

/**
 * Fetches analytics data: mood trends and activity.
 */
export async function getAnalyticsAction() {
  console.log("[ACTION START]", { action: "getAnalyticsAction" });
  try {
    const db = await getDb();
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
  } finally {
    console.log("[ACTION END]", { action: "getAnalyticsAction" });
  }
}

/**
 * Updates application settings.
 */
export async function updateSettingsAction(settings: any) {
  console.log("[ACTION START]", { action: "updateSettingsAction" });
  try {
    // In a real app, you might save these to a config file or DB.
    // For now, we'll return success to simulate the state update.
    console.log("Updating settings:", settings);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  } finally {
    console.log("[ACTION END]", { action: "updateSettingsAction" });
  }
}

/**
 * Fetches the Memory Graph: top nodes with their edges, plus graph stats.
 * Optional search query filters by label / description.
 */
export async function getGraphAction(query?: string) {
  console.log("[ACTION START]", { action: "getGraphAction", query });
  try {
    const db = await getDb();
    let nodeRows: any[];
    if (query) {
      const q = `%${query}%`;
      nodeRows = db.prepare(
        `SELECT * FROM memory_nodes WHERE label LIKE ? OR description LIKE ? ORDER BY importance DESC LIMIT 60`
      ).all(q, q);
    } else {
      nodeRows = db.prepare(
        `SELECT * FROM memory_nodes ORDER BY importance DESC, access_count DESC LIMIT 60`
      ).all();
    }

    // Attach edges to each node
    const edgeStmt = db.prepare(
      `SELECT e.*, n.label as target_label, n.type as target_type
       FROM memory_edges e
       JOIN memory_nodes n ON e.to_id = n.id
       WHERE e.from_id = ?
       ORDER BY e.weight DESC LIMIT 8`
    );

    const nodes = nodeRows.map(node => {
      const edges = (edgeStmt.all(node.id) as any[]).map(e => ({
        relation: e.relation,
        weight: e.weight,
        target: { label: e.target_label, type: e.target_type },
      }));
      return {
        ...node,
        tags: (() => { try { return JSON.parse(node.tags || "[]"); } catch { return []; } })(),
        edges,
      };
    });

    const stats = db.prepare(
      `SELECT
        (SELECT COUNT(*) FROM memory_nodes)    as nodeCount,
        (SELECT COUNT(*) FROM memory_edges)    as edgeCount,
        (SELECT COUNT(*) FROM memory_archives) as archivedCount`
    ).get();

    return { success: true, data: { nodes, stats } };
  } catch (error: any) {
    return { success: false, error: error.message };
  } finally {
    console.log("[ACTION END]", { action: "getGraphAction", query });
  }
}
