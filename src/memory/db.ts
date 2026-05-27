import { Database } from "bun:sqlite";
import { env } from "@config/index.js";
import { createLogger } from "@utils/logger.js";
import { mkdirSync, existsSync } from "fs";
import { dirname } from "path";

const log = createLogger("memory/db");

type DbRuntimeSingleton = {
  db: Database;
  migrationsRun: boolean;
};

const globalRuntime = globalThis as typeof globalThis & {
  __createrDbRuntime?: DbRuntimeSingleton;
};

function runMigrations(db: Database): void {
  log.info("Running database migrations...");

  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

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

    CREATE TABLE IF NOT EXISTS analytics (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics(event_type);

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

    CREATE TABLE IF NOT EXISTS memory_archives (
      id TEXT PRIMARY KEY,
      original_id TEXT NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      archived_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  log.info("All migrations applied successfully");
}

function createDatabaseRuntime(): DbRuntimeSingleton {
  const dbDir = dirname(env.SQLITE_DB_PATH);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
    log.info(`Created data directory: ${dbDir}`);
  }

  const db = new Database(env.SQLITE_DB_PATH);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA foreign_keys = ON");

  log.info(`SQLite database initialized at ${env.SQLITE_DB_PATH}`);
  runMigrations(db);

  return { db, migrationsRun: true };
}

const runtime = globalRuntime.__createrDbRuntime ?? createDatabaseRuntime();

if (globalRuntime.__createrDbRuntime) {
  console.log("SINGLETON RUNTIME REUSED", {
    runtime: "sqlite",
    dbPath: env.SQLITE_DB_PATH,
  });
} else {
  globalRuntime.__createrDbRuntime = runtime;
}

const { db } = runtime;

export { db };
export default db;
