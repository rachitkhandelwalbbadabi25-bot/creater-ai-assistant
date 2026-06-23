// src/memory/versioning.ts — Memory Versioning System
import { getDB } from "./db.js";
import { generateId } from "@utils/helpers.js";
import { createLogger } from "@utils/logger.js";
import { clearCache } from "./cache.js";

const log = createLogger("memory/versioning");

export interface MemoryVersion {
  id: string;
  entityType: string;
  entityId: string;
  previousValue: string | null;
  newValue: string;
  changedAt: string;
}

export function recordVersionChange(
  entityType: string,
  entityId: string,
  previousValue: string | null,
  newValue: string
): string {
  const db = getDB();
  const id = generateId();
  const changedAt = new Date().toISOString();

  db.prepare(`
    INSERT INTO memory_versions (id, entity_type, entity_id, previous_value, new_value, changed_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, entityType, entityId, previousValue, newValue, changedAt);

  log.mem(`Version archived: [${entityType}:${entityId}]`);
  return id;
}

export function getVersionHistory(entityType: string, entityId: string): MemoryVersion[] {
  const db = getDB();
  const rows = db.prepare(`
    SELECT id, entity_type as entityType, entity_id as entityId, previous_value as previousValue, new_value as newValue, changed_at as changedAt
    FROM memory_versions
    WHERE entity_type = ? AND entity_id = ?
    ORDER BY changed_at DESC
  `).all(entityType, entityId) as any[];

  return rows;
}

export function compareVersions(versionIdA: string, versionIdB: string): { diff: string } {
  const db = getDB();
  const verA = db.prepare(`SELECT new_value FROM memory_versions WHERE id = ?`).get(versionIdA) as any;
  const verB = db.prepare(`SELECT new_value FROM memory_versions WHERE id = ?`).get(versionIdB) as any;

  if (!verA || !verB) {
    throw new Error("One or both versions not found");
  }

  return {
    diff: `A: ${verA.new_value}\nB: ${verB.new_value}`
  };
}

export function rollbackVersion(versionId: string): boolean {
  const db = getDB();
  const version = db.prepare(`SELECT * FROM memory_versions WHERE id = ?`).get(versionId) as any;
  if (!version) return false;

  const entityType = version.entity_type;
  const entityId = version.entity_id;
  const targetValue = version.previous_value;

  if (targetValue === null) {
    if (entityType === "timeline_event") {
      db.prepare("DELETE FROM timeline_events WHERE id = ?").run(entityId);
      clearCache();
      return true;
    }
    return false;
  }

  if (entityType === "timeline_event") {
    const val = JSON.parse(targetValue);
    db.prepare("UPDATE timeline_events SET category = ?, title = ? WHERE id = ?").run(val.category, val.title, entityId);
    clearCache();
    return true;
  } else if (entityType === "personality_pattern") {
    const val = JSON.parse(targetValue);
    db.prepare("UPDATE personality_patterns SET confidence = ?, observations = ? WHERE pattern_name = ?").run(val.confidence, val.observations, entityId);
    clearCache();
    return true;
  }

  return false;
}
