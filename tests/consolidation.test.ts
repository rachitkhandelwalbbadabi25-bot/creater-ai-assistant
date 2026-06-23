// tests/consolidation.test.ts
import { expect, test, describe, beforeAll } from "bun:test";
import { initDatabase, getDB } from "../src/memory/db";
import { runMemoryConsolidation } from "../src/memory/consolidation";
import { generateId } from "../src/utils/helpers";

describe("Memory Consolidation Engine Tests", () => {
  beforeAll(() => {
    initDatabase();
  });

  test("Consolidate and merge duplicate facts", () => {
    const db = getDB();
    const val = `Unique test fact ${generateId().slice(0, 8)}`;
    const cat = `test_${generateId().slice(0, 8)}`;
    const key1 = `k1_${generateId().slice(0, 8)}`;
    const key2 = `k2_${generateId().slice(0, 8)}`;

    // Insert duplicate facts directly
    db.prepare("INSERT INTO facts (id, category, key, value, confidence, source) VALUES (?, ?, ?, ?, 1.0, 'user')").run(generateId(), cat, key1, val);
    db.prepare("INSERT INTO facts (id, category, key, value, confidence, source) VALUES (?, ?, ?, ?, 1.0, 'user')").run(generateId(), cat, key2, val);

    const stats = runMemoryConsolidation();
    expect(stats.merged).toBeGreaterThan(0);

    const count = db.prepare("SELECT COUNT(*) as count FROM facts WHERE value = ?").get(val) as any;
    expect(count.count).toBe(1); // Merged into one
  });

  test("Archive old low confidence stale facts", () => {
    const db = getDB();
    const val = `Stale test fact ${generateId().slice(0, 8)}`;

    // Insert low-confidence stale fact updated 40 days ago
    const id = generateId();
    db.prepare(`
      INSERT INTO facts (id, category, key, value, confidence, source, created_at, updated_at)
      VALUES (?, 'test', 'k_stale', ?, 0.1, 'user', datetime('now', '-40 days'), datetime('now', '-40 days'))
    `).run(id, val);

    const stats = runMemoryConsolidation();
    expect(stats.archived).toBeGreaterThan(0);

    const count = db.prepare("SELECT COUNT(*) as count FROM facts WHERE id = ?").get(id) as any;
    expect(count.count).toBe(0); // Deleted from active table

    const archiveCount = db.prepare("SELECT COUNT(*) as count FROM memory_archives WHERE original_id = ?").get(id) as any;
    expect(archiveCount.count).toBe(1); // Archived
  });
});
