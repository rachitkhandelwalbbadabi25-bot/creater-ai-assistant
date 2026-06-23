// src/memory/insights.ts — Insight Engine
import { getDB } from "./db.js";
import { generateId } from "@utils/helpers.js";
import { createLogger } from "@utils/logger.js";
import { setCached, getCached, invalidateCache } from "./cache.js";

const log = createLogger("memory/insights");

export interface MemoryInsight {
  id: string;
  insight: string;
  confidence: number;
  category: string;
  source: string;
  createdAt: string;
}

export function generateInsights(): number {
  const db = getDB();
  let count = 0;

  // 1. Analyse late night schedule
  const lateNight = db.prepare("SELECT * FROM personality_patterns WHERE pattern_name = 'work_schedule' AND observations LIKE '%late_night%'").get() as any;
  if (lateNight && lateNight.confidence > 0.7) {
    const ok = saveInsight("User consistently works late at night.", 0.9, "schedule", "personality_patterns");
    if (ok) count++;
  }

  // 2. Analyse AI interests
  const aiInterest = db.prepare("SELECT * FROM personality_patterns WHERE pattern_name = 'project_interests' AND observations LIKE '%AI Engineering%'").get() as any;
  if (aiInterest && aiInterest.confidence > 0.7) {
    const ok = saveInsight("User strongly prefers AI projects.", 0.95, "interests", "personality_patterns");
    if (ok) count++;
  }

  // 3. Analyse deadlines stress check (from timeline failures / categories)
  const deadlines = db.prepare("SELECT COUNT(*) as count FROM timeline_events WHERE category = 'failure' AND title LIKE '%deadline%'").get() as any;
  if (deadlines && deadlines.count >= 2) {
    const ok = saveInsight("User becomes stressed near deadlines.", 0.8, "emotion", "timeline_events");
    if (ok) count++;
  }

  if (count > 0) {
    invalidateCache("insights", "top");
  }

  return count;
}

function saveInsight(insight: string, confidence: number, category: string, source: string): boolean {
  const db = getDB();
  try {
    db.prepare(`
      INSERT INTO memory_insights (id, insight, confidence, category, source)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(insight) DO UPDATE SET
        confidence = MAX(confidence, excluded.confidence),
        created_at = datetime('now')
    `).run(generateId(), insight, confidence, category, source);
    return true;
  } catch (e) {
    log.error("Failed to save insight", e);
    return false;
  }
}

export function getTopInsights(limit = 10): MemoryInsight[] {
  const cacheKey = `top:${limit}`;
  const cached = getCached<MemoryInsight[]>("insights", cacheKey);
  if (cached) return cached;

  const db = getDB();
  const rows = db.prepare(`
    SELECT id, insight, confidence, category, source, created_at as createdAt
    FROM memory_insights
    ORDER BY confidence DESC, created_at DESC
    LIMIT ?
  `).all(limit) as any[];

  setCached("insights", cacheKey, rows);
  return rows;
}

export function validateInsight(insightId: string, confidence: number): boolean {
  const db = getDB();
  const res = db.prepare(`
    UPDATE memory_insights
    SET confidence = ?
    WHERE id = ?
  `).run(confidence, insightId);

  invalidateCache("insights", "top");
  return res.changes > 0;
}
