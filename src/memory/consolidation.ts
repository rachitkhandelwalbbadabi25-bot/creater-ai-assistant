// src/memory/consolidation.ts — Memory Consolidation Engine
import { getDB } from "./db.js";
import { createLogger } from "@utils/logger.js";
import { generateId } from "@utils/helpers.js";

const log = createLogger("memory/consolidation");

export function runMemoryConsolidation(): { merged: number; archived: number } {
  const db = getDB();
  let merged = 0;
  let archived = 0;

  // 1. Merge duplicates in facts table
  const facts = db.prepare("SELECT * FROM facts").all() as any[];
  const seen = new Map<string, string>(); // value -> id

  for (const fact of facts) {
    const valNormalized = fact.value.toLowerCase().trim();
    if (seen.has(valNormalized)) {
      const originalId = seen.get(valNormalized)!;
      // Backup/archive duplicate before deletion
      db.prepare(`
        INSERT INTO memory_archives (id, original_id, type, label, description)
        VALUES (?, ?, 'fact_duplicate', ?, ?)
      `).run(generateId(), fact.id, fact.key, fact.value);

      db.prepare("DELETE FROM facts WHERE id = ?").run(fact.id);
      merged++;
    } else {
      seen.set(valNormalized, fact.id);
    }
  }

  // 2. Archive low-importance stale facts
  // Stale = updated_at older than 30 days and confidence/importance < 0.2
  const staleFacts = db.prepare(`
    SELECT * FROM facts
    WHERE confidence < 0.2
      AND datetime(updated_at) < datetime('now', '-30 days')
  `).all() as any[];

  for (const fact of staleFacts) {
    db.prepare(`
      INSERT INTO memory_archives (id, original_id, type, label, description)
      VALUES (?, ?, 'fact_stale', ?, ?)
    `).run(generateId(), fact.id, fact.key, fact.value);

    db.prepare("DELETE FROM facts WHERE id = ?").run(fact.id);
    archived++;
  }

  log.info(`Memory consolidation completed: merged ${merged} duplicates, archived ${archived} stale entries.`);
  return { merged, archived };
}
