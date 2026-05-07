// ════════════════════════════════════════════════════════════════════════════════
// src/memory/db.ts — SQLite database initialization, schema, and migrations
// ════════════════════════════════════════════════════════════════════════════════

import Database from "better-sqlite3";
import { env } from "@config/index.js";
import { createLogger } from "@utils/logger.js";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";

const log = createLogger("memory/db");

// ─── Ensure data directory exists ─────────────────────────────────────────────────
const dbDir = dirname(env.SQLITE_DB_PATH);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
  log.info(`Created data directory: ${dbDir}`);
}

// ─── Initialize Database ──────────────────────────────────────────────────────────
const db = new Database(env.SQLITE_DB_PATH);

// Enable WAL mode for concurrent reads
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

log.info(`SQLite database initialized at ${env.SQLITE_DB_PATH}`);

// ─── Schema Migrations ───────────────────────────────────────────────────────────
function runMigrations(): void {
  log.info("Running database migrations...");

  db.exec(`
    -- Migration tracking
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Short-term memory: raw conversation messages
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'tui',
      emotion TEXT,
      intent TEXT,
      tokens_estimated INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);

    -- Mid-term memory: conversation summaries
    CREATE TABLE IF NOT EXISTS summaries (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      message_ids TEXT NOT NULL,       -- JSON array of message IDs this summarizes
      topic TEXT,
      importance REAL DEFAULT 0.5,      -- 0.0 to 1.0
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_summaries_topic ON summaries(topic);
    CREATE INDEX IF NOT EXISTS idx_summaries_importance ON summaries(importance);

    -- Long-term memory: core facts, preferences, persistent knowledge
    CREATE TABLE IF NOT EXISTS facts (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,           -- preference, fact, habit, person, project
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      source TEXT,                      -- which conversation/summary derived this
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(category, key)
    );
    CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(category);

    -- Tasks and reminders
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'done', 'cancelled')),
      priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'urgent')),
      project TEXT,
      due_date TEXT,
      reminder_at TEXT,
      tags TEXT,                        -- JSON array
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);

    -- Emotion history
    CREATE TABLE IF NOT EXISTS emotion_log (
      id TEXT PRIMARY KEY,
      mood TEXT NOT NULL,
      energy TEXT,
      confidence REAL,
      trigger TEXT,                     -- what caused this mood
      message_id TEXT REFERENCES messages(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_emotion_created ON emotion_log(created_at);

    -- Skills registry
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      trigger_patterns TEXT NOT NULL,   -- JSON array
      steps TEXT NOT NULL,              -- JSON array of actions
      usage_count INTEGER DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Interaction analytics (for self-improvement)
    CREATE TABLE IF NOT EXISTS analytics (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      data TEXT,                        -- JSON payload
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics(event_type);
  `);

  log.info("All migrations applied successfully");
}

// Run migrations on import
runMigrations();

// ─── Export DB instance ───────────────────────────────────────────────────────────
export { db };
export default db;
