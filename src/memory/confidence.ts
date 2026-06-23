// src/memory/confidence.ts — Confidence & Trust Scoring System
import { getDB } from "./db.js";
import { createLogger } from "@utils/logger.js";
import { clearCache } from "./cache.js";

const log = createLogger("memory/confidence");

export function calculateConfidence(source: string, type: string): number {
  if (source === "user_explicit") return 1.0;
  if (source === "auto-detected") return 0.7;
  if (source === "inferred" || type === "inferred") return 0.4;
  return 0.5;
}

export function updateConfidence(table: string, id: string, score: number): void {
  const db = getDB();
  const allowedTables = ["timeline_events", "personality_patterns", "memory_insights", "knowledge_categories", "knowledge_links", "memory_nodes", "memory_edges"];
  if (!allowedTables.includes(table)) {
    throw new Error(`Unauthorized table confidence update: ${table}`);
  }

  const idCol = table === "personality_patterns" ? "pattern_name" : "id";

  db.prepare(`
    UPDATE ${table}
    SET confidence = ?
    WHERE ${idCol} = ?
  `).run(score, id);

  clearCache();
  log.mem(`Updated confidence for [${table}:${id}] to ${score}`);
}

export function decayConfidence(table: string, decayFactor = 0.98): void {
  const db = getDB();
  const allowedTables = ["timeline_events", "personality_patterns", "memory_insights", "memory_nodes", "memory_edges"];
  if (!allowedTables.includes(table)) {
    throw new Error(`Unauthorized table decay: ${table}`);
  }

  const idCol = table === "personality_patterns" ? "pattern_name" : "id";

  db.prepare(`
    UPDATE ${table}
    SET confidence = confidence * ?
  `).run(decayFactor);

  clearCache();
  log.mem(`Decayed confidence for all entries in [${table}] by factor ${decayFactor}`);
}

export function validateMemory(table: string, id: string): void {
  updateConfidence(table, id, 1.0);
}
