// ════════════════════════════════════════════════════════════════════════════════
// src/memory/midTerm.ts — Mid-term memory: conversation summaries and topic clusters
// ════════════════════════════════════════════════════════════════════════════════

import { db } from "./db.js";
import { createLogger } from "@utils/logger.js";
import { generateId } from "@utils/helpers.js";
import { env } from "@config/index.js";

const log = createLogger("memory/midTerm");

export interface Summary {
  id: string;
  content: string;
  messageIds: string[];
  topic: string | null;
  importance: number;
  createdAt: string;
  expiresAt: string | null;
}

// ─── Prepared Statements ──────────────────────────────────────────────────────────
const insertStmt = db.prepare(`
  INSERT INTO summaries (id, content, message_ids, topic, importance, expires_at)
  VALUES (?, ?, ?, ?, ?, datetime('now', '+' || ? || ' days'))
`);

const recentStmt = db.prepare(`
  SELECT * FROM summaries
  WHERE (expires_at IS NULL OR expires_at > datetime('now'))
  ORDER BY importance DESC, created_at DESC
  LIMIT ?
`);

const byTopicStmt = db.prepare(`
  SELECT * FROM summaries
  WHERE topic = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
  ORDER BY created_at DESC
  LIMIT ?
`);

const searchStmt = db.prepare(`
  SELECT * FROM summaries
  WHERE content LIKE ? AND (expires_at IS NULL OR expires_at > datetime('now'))
  ORDER BY importance DESC
  LIMIT ?
`);

const promoteStmt = db.prepare(`
  UPDATE summaries SET importance = MIN(importance + 0.1, 1.0) WHERE id = ?
`);

const deleteExpiredStmt = db.prepare(`
  DELETE FROM summaries WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')
`);

// ─── Operations ───────────────────────────────────────────────────────────────────

/**
 * Store a conversation summary.
 * @param content - The summarized text
 * @param messageIds - IDs of messages this summary covers
 * @param topic - Optional topic label
 * @param importance - 0.0 to 1.0, higher = more important
 */
export function addSummary(
  content: string,
  messageIds: string[],
  topic?: string,
  importance = 0.5
): Summary {
  const id = generateId();
  const ttl = env.MID_TERM_TTL_DAYS;

  insertStmt.run(
    id, content,
    JSON.stringify(messageIds),
    topic ?? null,
    importance,
    ttl.toString()
  );

  log.mem(`Stored summary (importance: ${importance})`, { id, topic });

  return {
    id,
    content,
    messageIds,
    topic: topic ?? null,
    importance,
    createdAt: new Date().toISOString(),
    expiresAt: null,
  };
}

/**
 * Get the most important/recent summaries.
 */
export function getTopSummaries(limit = 10): Summary[] {
  const rows = recentStmt.all(limit) as Array<Record<string, unknown>>;
  return rows.map(parseSummaryRow);
}

/**
 * Get summaries by topic.
 */
export function getSummariesByTopic(topic: string, limit = 10): Summary[] {
  const rows = byTopicStmt.all(topic, limit) as Array<Record<string, unknown>>;
  return rows.map(parseSummaryRow);
}

/**
 * Full-text search across summaries.
 */
export function searchSummaries(query: string, limit = 10): Summary[] {
  const rows = searchStmt.all(`%${query}%`, limit) as Array<Record<string, unknown>>;
  return rows.map(parseSummaryRow);
}

/**
 * Increase a summary's importance (called when it's accessed/relevant).
 * This prevents important memories from expiring.
 */
export function promoteSummary(id: string): void {
  promoteStmt.run(id);
  log.mem(`Promoted summary importance`, { id });
}

/**
 * Clean up expired summaries.
 */
export function cleanExpired(): number {
  const result = deleteExpiredStmt.run();
  if (result.changes > 0) {
    log.info(`Cleaned ${result.changes} expired summaries`);
  }
  return result.changes;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────
function parseSummaryRow(row: Record<string, unknown>): Summary {
  return {
    id: row.id as string,
    content: row.content as string,
    messageIds: JSON.parse((row.message_ids as string) || "[]") as string[],
    topic: (row.topic as string) ?? null,
    importance: row.importance as number,
    createdAt: row.created_at as string,
    expiresAt: (row.expires_at as string) ?? null,
  };
}
