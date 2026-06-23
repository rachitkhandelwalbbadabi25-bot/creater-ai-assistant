// src/memory/timeline.ts — Life Timeline Engine
import { getDB } from "./db.js";
import { generateId } from "@utils/helpers.js";
import { createLogger } from "@utils/logger.js";
import { setCached, getCached, invalidateCache } from "./cache.js";
import { recordVersionChange } from "./versioning.ts";


const log = createLogger("memory/timeline");

export type TimelineCategory =
  | "achievement"
  | "goal"
  | "project"
  | "milestone"
  | "learning"
  | "failure"
  | "decision"
  | "relationship"
  | "health"
  | "career";

export interface TimelineEvent {
  id: string;
  category: TimelineCategory;
  title: string;
  description: string | null;
  timestamp: string;
  importance: number;
  confidence: number;
  tags: string[];
  metadata: Record<string, any>;
}

export function recordEvent(
  category: TimelineCategory,
  title: string,
  description?: string,
  importance = 0.5,
  confidence = 1.0,
  tags: string[] = [],
  metadata: Record<string, any> = {}
): TimelineEvent {
  const db = getDB();
  const id = generateId();
  const timestamp = new Date().toISOString();

  db.prepare(`
    INSERT INTO timeline_events (id, category, title, description, timestamp, importance, confidence, tags, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    category,
    title,
    description ?? null,
    timestamp,
    importance,
    confidence,
    JSON.stringify(tags),
    JSON.stringify(metadata)
  );

  // Invalidate cache
  invalidateCache("timeline");

  // Record version change
  recordVersionChange("timeline_event", id, null, JSON.stringify({ category, title }));

  log.info(`Recorded timeline event: [${category}] ${title}`);
  return {
    id,
    category,
    title,
    description: description ?? null,
    timestamp,
    importance,
    confidence,
    tags,
    metadata
  };
}

export function getTimeline(options: {
  category?: TimelineCategory;
  limit?: number;
  minImportance?: number;
} = {}): TimelineEvent[] {
  const cacheKey = `timeline:${options.category ?? "all"}:${options.limit ?? 100}:${options.minImportance ?? 0}`;
  const cached = getCached<TimelineEvent[]>("timeline", cacheKey);
  if (cached) return cached;

  const db = getDB();
  let query = `SELECT * FROM timeline_events WHERE 1=1`;
  const params: any[] = [];

  if (options.category) {
    query += ` AND category = ?`;
    params.push(options.category);
  }
  if (options.minImportance) {
    query += ` AND importance >= ?`;
    params.push(options.minImportance);
  }
  query += ` ORDER BY timestamp DESC`;
  if (options.limit) {
    query += ` LIMIT ?`;
    params.push(options.limit);
  }

  const rows = db.prepare(query).all(...params) as any[];
  const events = rows.map(r => ({
    ...r,
    tags: JSON.parse(r.tags || "[]"),
    metadata: JSON.parse(r.metadata || "{}")
  }));

  setCached("timeline", cacheKey, events);
  return events;
}

export function getMonthlySummary(year: number, month: number): string {
  const cacheKey = `summary:${year}-${month}`;
  const cached = getCached<string>("timeline", cacheKey);
  if (cached) return cached;

  const db = getDB();
  // Pad month with 0
  const monthStr = month.toString().padStart(2, "0");
  const prefix = `${year}-${monthStr}`;

  const rows = db.prepare(`
    SELECT * FROM timeline_events
    WHERE timestamp LIKE ?
    ORDER BY timestamp ASC
  `).all(`${prefix}%`) as any[];

  if (rows.length === 0) return `No timeline events recorded for ${year}-${monthStr}.`;

  const summary = rows.map(r => `- [${r.category}] ${r.title}: ${r.description ?? ""}`).join("\n");
  setCached("timeline", cacheKey, summary);
  return summary;
}

export function getYearlySummary(year: number): string {
  const cacheKey = `summary:${year}`;
  const cached = getCached<string>("timeline", cacheKey);
  if (cached) return cached;

  const db = getDB();
  const rows = db.prepare(`
    SELECT * FROM timeline_events
    WHERE timestamp LIKE ?
    ORDER BY timestamp ASC
  `).all(`${year}%`) as any[];

  if (rows.length === 0) return `No timeline events recorded for ${year}.`;

  const summary = rows.map(r => `- [${r.category}] ${r.title} (${r.timestamp.split("T")[0]})`).join("\n");
  setCached("timeline", cacheKey, summary);
  return summary;
}

export function getMajorMilestones(limit = 10): TimelineEvent[] {
  return getTimeline({ minImportance: 0.8, limit });
}

/**
 * Auto-detect major milestones and events from user messages asynchronously.
 */
export async function autoDetectTimelineEvents(text: string): Promise<void> {
  const lower = text.toLowerCase();
  
  // Simple heuristic checks for event detection to keep things lightning fast
  if (lower.includes("selected") || lower.includes("won") || lower.includes("passed") || lower.includes("achieved")) {
    recordEvent("achievement", text.slice(0, 100), text, 0.8, 0.7, ["auto-detected", "achievement"]);
  } else if (lower.includes("started") || lower.includes("launched") || lower.includes("began")) {
    recordEvent("project", text.slice(0, 100), text, 0.7, 0.7, ["auto-detected", "project"]);
  } else if (lower.includes("failed") || lower.includes("lost") || lower.includes("rejected")) {
    recordEvent("failure", text.slice(0, 100), text, 0.6, 0.7, ["auto-detected", "failure"]);
  } else if (lower.includes("decided") || lower.includes("chose")) {
    recordEvent("decision", text.slice(0, 100), text, 0.6, 0.7, ["auto-detected", "decision"]);
  }
}
