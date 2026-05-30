// ════════════════════════════════════════════════════════════════════════════════
// src/memory/shortTerm.ts — Short-term memory: recent conversation messages
// ════════════════════════════════════════════════════════════════════════════════

import { db } from "./db.js";
import { createLogger } from "@utils/logger.js";
import { generateId, estimateTokens } from "@utils/helpers.js";
import { env } from "@config/index.js";

const log = createLogger("memory/shortTerm");

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  channel: string;
  emotion?: string;
  intent?: string;
  tokensEstimated: number;
  createdAt: string;
  expiresAt: string | null;
}

// ─── Prepared Statements (cached for performance) ─────────────────────────────────
const insertStmt = db.prepare(`
  INSERT INTO messages (id, role, content, channel, emotion, intent, tokens_estimated, expires_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' hours'))
`);

const recentStmt = db.prepare(`
  SELECT * FROM messages
  WHERE (expires_at IS NULL OR expires_at > datetime('now'))
  ORDER BY created_at DESC
  LIMIT ?
`);

const byChannelStmt = db.prepare(`
  SELECT * FROM messages
  WHERE channel = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
  ORDER BY created_at DESC
  LIMIT ?
`);

const deleteExpiredStmt = db.prepare(`
  DELETE FROM messages WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')
`);

const countStmt = db.prepare(`
  SELECT COUNT(*) as count FROM messages
  WHERE (expires_at IS NULL OR expires_at > datetime('now'))
`);

// ─── Operations ───────────────────────────────────────────────────────────────────

/**
 * Store a new message in short-term memory.
 */
export function addMessage(
  role: Message["role"],
  content: string,
  channel = "tui",
  metadata?: { emotion?: string; intent?: string }
): Message {
  const id = generateId();
  const tokens = estimateTokens(content);
  const ttl = env.SHORT_TERM_TTL_HOURS;

  setTimeout(() => {
    try {
      insertStmt.run(
        id, role, content, channel,
        metadata?.emotion ?? null,
        metadata?.intent ?? null,
        tokens,
        ttl.toString()
      );
    } catch (err) {
      log.error("Failed to insert message asynchronously", err);
    }
  }, 0);

  log.mem(`Stored ${role} message (${tokens} tokens)`, { id, channel });

  return {
    id,
    role,
    content,
    channel,
    emotion: metadata?.emotion,
    intent: metadata?.intent,
    tokensEstimated: tokens,
    createdAt: new Date().toISOString(),
    expiresAt: null,
  };
}

/**
 * Get recent messages (newest first).
 */
export function getRecentMessages(limit = 20): Message[] {
  return recentStmt.all(limit) as Message[];
}

/**
 * Get recent messages for a specific channel (tui, telegram, web).
 */
export function getChannelMessages(channel: string, limit = 20): Message[] {
  return byChannelStmt.all(channel, limit) as Message[];
}

/**
 * Get messages formatted as chat history for LLM consumption.
 * Returns in chronological order (oldest first).
 */
export function getChatHistory(limit = 10): Array<{ role: string; content: string }> {
  const messages = getRecentMessages(limit);
  return messages
    .reverse() // chronological order
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Get total active message count.
 */
export function getMessageCount(): number {
  const result = countStmt.get() as { count: number };
  return result.count;
}

/**
 * Clean up expired messages. Called periodically.
 */
export function cleanExpired(): number {
  const result = deleteExpiredStmt.run();
  if (result.changes > 0) {
    log.info(`Cleaned ${result.changes} expired messages`);
  }
  return result.changes;
}
