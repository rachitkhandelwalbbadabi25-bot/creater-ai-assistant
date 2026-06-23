// src/memory/evolution.ts — Personality Evolution Engine
import { getDB } from "./db.js";
import { createLogger } from "@utils/logger.js";
import { recordVersionChange } from "./versioning.js";

const log = createLogger("memory/evolution");

export interface PersonalityPattern {
  patternName: string;
  confidence: number;
  observations: string[];
  lastUpdated: string;
}

export function updatePatterns(text: string, timestamp = new Date().toISOString()): void {
  const db = getDB();
  const lower = text.toLowerCase();
  
  // Analyse preferred language (e.g., Hinglish if words like kya, kaise, bro, yaar, hai, etc. are used)
  const hinglishKeywords = ["kya", "kaise", "kab", "hai", "yaar", "bro", "bhai", "acha", "theek"];
  const isHinglish = hinglishKeywords.some(w => lower.includes(w));
  if (isHinglish) {
    savePattern("preferred_language", "Hinglish", 0.8, text);
  }

  // Analyse reply style preferences
  if (lower.includes("concise") || lower.includes("short") || lower.includes("brief") || lower.includes("kam sabdo me")) {
    savePattern("response_length", "concise", 0.9, text);
  } else if (lower.includes("detailed") || lower.includes("explain") || lower.includes("samjhao")) {
    savePattern("response_length", "detailed", 0.8, text);
  }

  // Analyse work hours from the message timestamp
  const hour = new Date(timestamp).getHours();
  if (hour >= 23 || hour <= 4) {
    savePattern("work_schedule", "late_night", 0.85, `Message at ${hour}:00`);
  } else if (hour >= 8 && hour <= 12) {
    savePattern("work_schedule", "morning", 0.7, `Message at ${hour}:00`);
  }

  // Analyse project interests
  if (lower.includes("ai") || lower.includes("agent") || lower.includes("llm") || lower.includes("openai")) {
    savePattern("project_interests", "AI Engineering", 0.9, text);
  }
}

function savePattern(name: string, value: string, confidenceBoost: number, observation: string) {
  const db = getDB();
  const existing = db.prepare("SELECT * FROM personality_patterns WHERE pattern_name = ?").get(name) as any;

  let observations: string[] = [];
  let confidence = confidenceBoost;

  if (existing) {
    try { observations = JSON.parse(existing.observations || "[]"); } catch { observations = []; }
    confidence = Math.min(1.0, (existing.confidence + confidenceBoost) / 2);
  }

  if (!observations.includes(value)) {
    observations.push(value);
  }

  const prevValStr = existing ? JSON.stringify({ confidence: existing.confidence, observations }) : null;
  const newValStr = JSON.stringify({ confidence, observations });

  db.prepare(`
    INSERT INTO personality_patterns (pattern_name, confidence, observations, last_updated)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(pattern_name) DO UPDATE SET
      confidence = excluded.confidence,
      observations = excluded.observations,
      last_updated = datetime('now')
  `).run(name, confidence, JSON.stringify(observations));

  recordVersionChange("personality_pattern", name, prevValStr, newValStr);
  log.info(`Updated personality pattern [${name}] to [${value}] (confidence: ${confidence.toFixed(2)})`);
}

export function getPersonalityProfile(): PersonalityPattern[] {
  const db = getDB();
  const rows = db.prepare("SELECT pattern_name as patternName, confidence, observations, last_updated as lastUpdated FROM personality_patterns").all() as any[];

  return rows.map(r => ({
    ...r,
    observations: JSON.parse(r.observations || "[]")
  }));
}

export function getBehaviorSummary(): string {
  const profile = getPersonalityProfile();
  if (profile.length === 0) return "No behavioral patterns observed yet.";

  return profile
    .map(p => `- Preferred ${p.patternName.replace("_", " ")}: ${p.observations.join(", ")} (confidence: ${(p.confidence * 100).toFixed(0)}%)`)
    .join("\n");
}
