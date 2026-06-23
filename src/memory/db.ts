// src/memory/db.ts — SQLite database singleton
// initDatabase() must be called once at process startup (src/index.ts or equivalent).
// getDB() returns the live instance. db is a lazy proxy so existing callers work.

import { Database } from "bun:sqlite";
import { env } from "@config/index.js";
import { createLogger } from "@utils/logger.js";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";

const log = createLogger("memory/db");

// ─── globalThis keys ──────────────────────────────────────────────────────────
declare global {
  var __dbInstance: InstanceType<typeof Database> | undefined;
  var __dbMigrationsRun: boolean | undefined;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Must be called ONCE at process startup before any DB operation.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initDatabase(): void {
  if (globalThis.__dbInstance) return; // already initialised

  // Ensure data directory exists
  const dbDir = dirname(env.SQLITE_DB_PATH);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
    log.info(`Created data directory: ${dbDir}`);
  }

  const instance = new Database(env.SQLITE_DB_PATH);
  instance.exec("PRAGMA journal_mode = WAL");
  instance.exec("PRAGMA busy_timeout = 5000");
  instance.exec("PRAGMA foreign_keys = ON");
  log.info("SQLite database initialized", { path: env.SQLITE_DB_PATH });

  // Migrations run exactly once per process
  if (!globalThis.__dbMigrationsRun) {
    runMigrations(instance);
    globalThis.__dbMigrationsRun = true;
  }

  globalThis.__dbInstance = instance;
}

/**
 * Returns the singleton Database instance.
 * Auto-initialises if not yet done (lazy fallback for modules that import `db`
 * before initDatabase() is called at boot — this preserves backwards compat).
 */
export function getDB(): InstanceType<typeof Database> {
  if (!globalThis.__dbInstance) {
    initDatabase();
  }
  return globalThis.__dbInstance!;
}

// ─── Named export (backwards compat) ─────────────────────────────────────────
// Modules like shortTerm.ts, longTerm.ts etc. do `import { db } from "./db.js"`
// and then use `db.prepare(...)` at module scope to cache statements.
// We make `db` a lazy Proxy so prepared statements are created on first access
// (which happens after initDatabase() runs), not at import time.
export const db: InstanceType<typeof Database> = new Proxy({} as InstanceType<typeof Database>, {
  get(_target, prop) {
    const instance = getDB() as any;
    const value = instance[prop];
    return typeof value === "function" ? value.bind(instance) : value;
  },
  set(_target, prop, value) {
    (getDB() as any)[prop] = value;
    return true;
  },
});

// ─── Schema Migrations ────────────────────────────────────────────────────────
function runMigrations(instance: InstanceType<typeof Database>): void {
  log.info("Running database migrations...");

  instance.exec(`
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
      message_ids TEXT NOT NULL,
      topic TEXT,
      importance REAL DEFAULT 0.5,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_summaries_topic ON summaries(topic);
    CREATE INDEX IF NOT EXISTS idx_summaries_importance ON summaries(importance);

    -- Long-term memory: core facts, preferences, persistent knowledge
    CREATE TABLE IF NOT EXISTS facts (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      confidence REAL DEFAULT 1.0,
      source TEXT,
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
      tags TEXT,
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
      trigger TEXT,
      message_id TEXT REFERENCES messages(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_emotion_created ON emotion_log(created_at);

    -- Skills registry
    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      trigger_patterns TEXT NOT NULL,
      steps TEXT NOT NULL,
      usage_count INTEGER DEFAULT 0,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Interaction analytics
    CREATE TABLE IF NOT EXISTS analytics (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics(event_type);

    -- Memory Graph: Nodes
    CREATE TABLE IF NOT EXISTS memory_nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      label TEXT NOT NULL UNIQUE,
      description TEXT,
      tags TEXT DEFAULT '[]',
      importance REAL DEFAULT 0.5,
      access_count INTEGER DEFAULT 0,
      last_accessed TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_nodes_type ON memory_nodes(type);
    CREATE INDEX IF NOT EXISTS idx_nodes_importance ON memory_nodes(importance DESC);
    CREATE INDEX IF NOT EXISTS idx_nodes_label ON memory_nodes(label);

    -- Memory Graph: Edges
    CREATE TABLE IF NOT EXISTS memory_edges (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
      to_id TEXT NOT NULL REFERENCES memory_nodes(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      context TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(from_id, to_id, relation)
    );
    CREATE INDEX IF NOT EXISTS idx_edges_from ON memory_edges(from_id);
    CREATE INDEX IF NOT EXISTS idx_edges_to ON memory_edges(to_id);
    CREATE INDEX IF NOT EXISTS idx_edges_relation ON memory_edges(relation);

    -- Memory Archives
    CREATE TABLE IF NOT EXISTS memory_archives (
      id TEXT PRIMARY KEY,
      original_id TEXT NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      archived_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Settings store
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Phase 5: Life Timeline Engine
    CREATE TABLE IF NOT EXISTS timeline_events (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK(category IN ('achievement', 'goal', 'project', 'milestone', 'learning', 'failure', 'decision', 'relationship', 'health', 'career')),
      title TEXT NOT NULL,
      description TEXT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      importance REAL DEFAULT 0.5,
      confidence REAL DEFAULT 1.0,
      tags TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_timeline_timestamp ON timeline_events(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_timeline_category ON timeline_events(category);

    -- Phase 5: Personality Evolution Engine
    CREATE TABLE IF NOT EXISTS personality_patterns (
      pattern_name TEXT PRIMARY KEY,
      confidence REAL DEFAULT 1.0,
      observations TEXT DEFAULT '[]',
      last_updated TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Phase 5: Personal Knowledge Base
    CREATE TABLE IF NOT EXISTS knowledge_categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE CHECK(name IN ('education', 'career', 'projects', 'health', 'finance', 'relationships', 'preferences', 'goals', 'skills', 'personal_information')),
      description TEXT,
      confidence REAL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS knowledge_links (
      id TEXT PRIMARY KEY,
      from_category TEXT NOT NULL REFERENCES knowledge_categories(name) ON DELETE CASCADE,
      to_category TEXT NOT NULL REFERENCES knowledge_categories(name) ON DELETE CASCADE,
      description TEXT,
      weight REAL DEFAULT 1.0,
      confidence REAL DEFAULT 1.0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(from_category, to_category)
    );

    -- Phase 5: Insight Engine
    CREATE TABLE IF NOT EXISTS memory_insights (
      id TEXT PRIMARY KEY,
      insight TEXT NOT NULL UNIQUE,
      confidence REAL DEFAULT 1.0,
      category TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_insights_confidence ON memory_insights(confidence DESC);

    -- Phase 5: Memory Versioning System
    CREATE TABLE IF NOT EXISTS memory_versions (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      previous_value TEXT,
      new_value TEXT NOT NULL,
      changed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_versions_entity ON memory_versions(entity_type, entity_id);
  `);

  // Safely add confidence column to memory_nodes and memory_edges if not already present
  try {
    instance.exec("ALTER TABLE memory_nodes ADD COLUMN confidence REAL DEFAULT 1.0");
  } catch (e) {
    // Column already exists or table doesn't support it (ignored for backward compatibility)
  }

  try {
    instance.exec("ALTER TABLE memory_edges ADD COLUMN confidence REAL DEFAULT 1.0");
  } catch (e) {
    // Column already exists
  }

  log.info("All migrations applied successfully");
}

export default db;
