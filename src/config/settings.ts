// ════════════════════════════════════════════════════════════════════════════════
// src/config/settings.ts — Dynamic settings persistent layer using SQLite
// ════════════════════════════════════════════════════════════════════════════════

import { db } from "@memory/db.js";
import { env } from "./index.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("config/settings");

/**
 * Get a saved setting from the SQLite database.
 */
export function getSetting(key: string, defaultValue = ""): string {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? row.value : defaultValue;
  } catch (err) {
    log.error(`Failed to get setting '${key}'`, err);
    return defaultValue;
  }
}

/**
 * Set a setting in the database and keep the in-memory 'env' config in sync.
 */
export function setSetting(key: string, value: string): void {
  try {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?").run(key, value, value);
    
    // Dynamically keep runtime env in sync
    if (key in env) {
      (env as any)[key] = value || undefined;
      log.info(`Updated config '${key}' to: ${key.includes("KEY") ? "********" : value}`);
    }
  } catch (err) {
    log.error(`Failed to set setting '${key}'`, err);
  }
}

/**
 * Load all persisted overrides from the database and apply them onto env at startup.
 */
export function loadPersistedSettings(): void {
  try {
    const rows = db.prepare("SELECT key, value FROM settings").all() as { key: string; value: string }[];
    for (const row of rows) {
      if (row.key in env) {
        if (row.value === "") {
          (env as any)[row.key] = undefined;
        } else {
          (env as any)[row.key] = row.value;
        }
        log.info(`Loaded setting override: ${row.key} = ${row.key.includes("KEY") ? "********" : row.value}`);
      }
    }
  } catch (err) {
    log.error("Failed to load persisted settings at startup", err);
  }
}
