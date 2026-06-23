// ════════════════════════════════════════════════════════════════════════════════
// src/emotion/learner.ts — Continuous learning from user interactions
// Tracks patterns over time to improve emotion detection accuracy.
// ════════════════════════════════════════════════════════════════════════════════

import { getDB } from "@memory/db.js";
import { getMoodDistribution, getRecentMoods } from "./personalMap.js";
import { storeFact } from "@memory/longTerm.js";
import { createLogger } from "@utils/logger.js";
import type { Mood } from "./keywords.js";

const log = createLogger("emotion/learner");

// ─── Time-of-Day Mood Patterns ────────────────────────────────────────────────────
interface TimePattern {
  hour: number;
  dominantMood: Mood;
  sampleCount: number;
}

let timePatternStmt: any;

function getTimePatternStmt() {
  if (!timePatternStmt) {
    timePatternStmt = getDB().prepare(`
      SELECT
        CAST(strftime('%H', created_at) AS INTEGER) as hour,
        mood,
        COUNT(*) as count
      FROM emotion_log
      WHERE created_at > datetime('now', '-30 days')
      GROUP BY hour, mood
      ORDER BY hour, count DESC
    `);
  }
  return timePatternStmt;
}

/**
 * Analyze what moods are most common at each hour of the day.
 * Useful for proactive support ("user usually gets stressed around 3 PM").
 */
export function getTimePatterns(): TimePattern[] {
  const rows = getTimePatternStmt().all() as Array<{ hour: number; mood: Mood; count: number }>;
  const byHour = new Map<number, { mood: Mood; count: number }>();

  for (const row of rows) {
    const existing = byHour.get(row.hour);
    if (!existing || row.count > existing.count) {
      byHour.set(row.hour, { mood: row.mood, count: row.count });
    }
  }

  return Array.from(byHour.entries()).map(([hour, data]) => ({
    hour,
    dominantMood: data.mood,
    sampleCount: data.count,
  }));
}

/**
 * Detect mood trends — is the user's mood improving or declining?
 * Compares last 3 days vs previous 7 days.
 */
export function detectMoodTrend(): "improving" | "declining" | "stable" {
  const recentDist = getMoodDistribution(3);
  const olderDist = getMoodDistribution(10);

  const positiveSet = new Set<Mood>(["happy", "excited", "motivated", "grateful"]);
  const negativeSet = new Set<Mood>(["sad", "angry", "frustrated", "stressed", "anxious", "tired"]);

  const recentPositive = recentDist.filter(d => positiveSet.has(d.mood)).reduce((s, d) => s + d.count, 0);
  const recentNegative = recentDist.filter(d => negativeSet.has(d.mood)).reduce((s, d) => s + d.count, 0);
  const olderPositive = olderDist.filter(d => positiveSet.has(d.mood)).reduce((s, d) => s + d.count, 0);
  const olderNegative = olderDist.filter(d => negativeSet.has(d.mood)).reduce((s, d) => s + d.count, 0);

  const recentRatio = recentPositive / Math.max(recentNegative, 1);
  const olderRatio = olderPositive / Math.max(olderNegative, 1);

  if (recentRatio > olderRatio * 1.2) return "improving";
  if (recentRatio < olderRatio * 0.8) return "declining";
  return "stable";
}

/**
 * Persist learned patterns to long-term memory as facts.
 * Called periodically by the maintenance scheduler.
 */
export function persistLearnedPatterns(): void {
  const trend = detectMoodTrend();
  storeFact("habit", "mood_trend", trend, 0.7, "emotion_learner");

  const patterns = getTimePatterns();
  const stressHours = patterns
    .filter(p => ["stressed", "frustrated", "anxious"].includes(p.dominantMood) && p.sampleCount >= 3)
    .map(p => `${p.hour}:00`);

  if (stressHours.length > 0) {
    storeFact("habit", "stress_peak_hours", stressHours.join(", "), 0.6, "emotion_learner");
  }

  const happyHours = patterns
    .filter(p => ["happy", "excited", "motivated"].includes(p.dominantMood) && p.sampleCount >= 3)
    .map(p => `${p.hour}:00`);

  if (happyHours.length > 0) {
    storeFact("habit", "productive_hours", happyHours.join(", "), 0.6, "emotion_learner");
  }

  log.info(`Persisted learned patterns: trend=${trend}, stressHours=${stressHours.length}, happyHours=${happyHours.length}`);
}
