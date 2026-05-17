// ════════════════════════════════════════════════════════════════════════════════
// src/memory/db.ts — SQLite database initialization, schema, and migrations
// ════════════════════════════════════════════════════════════════════════════════

import { Database } from "bun:sqlite";
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
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA busy_timeout = 5000");
db.exec("PRAGMA foreign_keys = ON");

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

    -- ─── Memory Graph: Nodes ──────────────────────────────────────────────────
    -- Each node is a concept/entity: person, preference, project, habit, topic
    CREATE TABLE IF NOT EXISTS memory_nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,               -- person | preference | project | habit | topic | emotion | skill
      label TEXT NOT NULL UNIQUE,       -- unique display name used as natural key
      description TEXT,                 -- richer text content
      tags TEXT DEFAULT '[]',           -- JSON string array of tags
      importance REAL DEFAULT 0.5,      -- 0.0–1.0, used for ranking and archival
      access_count INTEGER DEFAULT 0,   -- how often this node is referenced
      last_accessed TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_nodes_type ON memory_nodes(type);
    CREATE INDEX IF NOT EXISTS idx_nodes_importance ON memory_nodes(importance DESC);
    CREATE INDEX IF NOT EXISTS idx_nodes_label ON memory_nodes(label);

    -- ─── Memory Graph: Edges ──────────────────────────────────────────────────
    -- Directed, typed relationships between nodes
    CREATE TABLE IF NOT EXISTS memory_edges (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
      to_id TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,           -- likes | dislikes | uses | works_on | knows | has_habit | related_to | prefers
      weight REAL DEFAULT 1.0,          -- strength of the relationship
      context TEXT,                     -- optional explanation / source sentence
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(from_id, to_id, relation)
    );
    CREATE INDEX IF NOT EXISTS idx_edges_from ON memory_edges(from_id);
    CREATE INDEX IF NOT EXISTS idx_edges_to ON memory_edges(to_id);
    CREATE INDEX IF NOT EXISTS idx_edges_relation ON memory_edges(relation);

    -- ─── Memory Archives ──────────────────────────────────────────────────────
    -- Low-importance nodes moved here after archival
    CREATE TABLE IF NOT EXISTS memory_archives (
      id TEXT PRIMARY KEY,
      original_id TEXT NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      archived_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Settings store for dynamic config overrides
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  log.info("All migrations applied successfully");
}

// Run migrations on import
runMigrations();

// ─── Export DB instance ───────────────────────────────────────────────────────────
export { db };
export default db;
