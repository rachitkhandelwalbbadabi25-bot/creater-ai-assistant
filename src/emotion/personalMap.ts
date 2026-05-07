// ════════════════════════════════════════════════════════════════════════════════
// src/emotion/personalMap.ts — User's evolving personality/emotion profile
// ════════════════════════════════════════════════════════════════════════════════

import { db } from "@memory/db.js";
import { createLogger } from "@utils/logger.js";
import { generateId } from "@utils/helpers.js";
import type { Mood, EnergyLevel } from "./keywords.js";

const log = createLogger("emotion/personalMap");

const insertLogStmt = db.prepare(`
  INSERT INTO emotion_log (id, mood, energy, confidence, trigger, message_id)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const recentMoodsStmt = db.prepare(`
  SELECT mood, energy, confidence, created_at FROM emotion_log
  ORDER BY created_at DESC LIMIT ?
`);
const moodDistStmt = db.prepare(`
  SELECT mood, COUNT(*) as count FROM emotion_log
  WHERE created_at > datetime('now', '-' || ? || ' days')
  GROUP BY mood ORDER BY count DESC
`);

export function logEmotion(
  mood: Mood, energy: EnergyLevel, confidence: number,
  trigger?: string, messageId?: string
): void {
  insertLogStmt.run(generateId(), mood, energy, confidence, trigger ?? null, messageId ?? null);
  log.mem(`Logged: ${mood} (${energy}, ${(confidence * 100).toFixed(0)}%)`);
}

export function getRecentMoods(limit = 10) {
  return recentMoodsStmt.all(limit) as Array<{
    mood: Mood; energy: EnergyLevel; confidence: number; created_at: string;
  }>;
}

export function getMoodDistribution(days = 7) {
  return moodDistStmt.all(days.toString()) as Array<{ mood: Mood; count: number }>;
}

export function getDominantMood(): Mood {
  const recent = getRecentMoods(5);
  if (!recent.length) return "neutral";
  const counts = new Map<Mood, number>();
  for (const e of recent) counts.set(e.mood, (counts.get(e.mood) ?? 0) + 1);
  let best: Mood = "neutral", bestN = 0;
  for (const [m, n] of counts) if (n > bestN) { best = m; bestN = n; }
  return best;
}

export function buildEmotionProfile(): string {
  const dom = getDominantMood();
  const dist = getMoodDistribution(7);
  const recent = getRecentMoods(3);
  const lines = [`[EMOTION PROFILE]`, `Dominant: ${dom}`];
  if (dist.length) lines.push(`7-day: ${dist.map(d => `${d.mood}(${d.count})`).join(", ")}`);
  if (recent.length) lines.push(`Recent: ${recent.map(r => r.mood).join(" → ")}`);
  return lines.join("\n");
}
