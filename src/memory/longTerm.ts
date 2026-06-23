// ════════════════════════════════════════════════════════════════════════════════
// src/memory/longTerm.ts — Long-term memory: core facts, preferences, persistent knowledge
// ════════════════════════════════════════════════════════════════════════════════

import { getDB } from "./db.js";
import { createLogger } from "@utils/logger.js";
import { generateId } from "@utils/helpers.js";
import { autoLinkFact } from "./graph.js";

const log = createLogger("memory/longTerm");

export type FactCategory = "preference" | "fact" | "habit" | "person" | "project" | "skill" | "health";

export interface Fact {
  id: string;
  category: FactCategory;
  key: string;
  value: string;
  confidence: number;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Prepared Statements ──────────────────────────────────────────────────────────
let preparedStatements: {
  upsertStmt: any;
  getByKeyStmt: any;
  getByCategoryStmt: any;
  searchStmt: any;
  allStmt: any;
  deleteStmt: any;
} | undefined;

function statements() {
  if (!preparedStatements) {
    const db = getDB();
    preparedStatements = {
      upsertStmt: db.prepare(`
        INSERT INTO facts (id, category, key, value, confidence, source)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(category, key) DO UPDATE SET
          value = excluded.value,
          confidence = excluded.confidence,
          source = excluded.source,
          updated_at = datetime('now')
      `),
      getByKeyStmt: db.prepare(`SELECT * FROM facts WHERE category = ? AND key = ?`),
      getByCategoryStmt: db.prepare(`SELECT * FROM facts WHERE category = ? ORDER BY updated_at DESC`),
      searchStmt: db.prepare(`SELECT * FROM facts WHERE key LIKE ? OR value LIKE ? ORDER BY confidence DESC LIMIT ?`),
      allStmt: db.prepare(`SELECT * FROM facts ORDER BY category, updated_at DESC`),
      deleteStmt: db.prepare(`DELETE FROM facts WHERE id = ?`),
    };
  }
  return preparedStatements;
}

// ─── Operations ───────────────────────────────────────────────────────────────────

/**
 * Store or update a long-term fact. Uses upsert — if the category+key combo
 * already exists, it updates the value and bumps updated_at.
 *
 * Examples:
 *   storeFact("preference", "code_editor", "VS Code")
 *   storeFact("person", "best_friend_name", "Arjun")
 *   storeFact("habit", "wakes_up_at", "7:30 AM")
 */
export function storeFact(
  category: FactCategory,
  key: string,
  value: string,
  confidence = 1.0,
  source?: string
): Fact {
  const id = generateId();
  statements().upsertStmt.run(id, category, key, value, confidence, source ?? null);
  log.mem(`Stored fact: [${category}] ${key} = ${value}`);
  // Auto-link into the knowledge graph
  try { autoLinkFact(category, key, value); } catch (_) {}
  return { id, category, key, value, confidence, source: source ?? null, createdAt: "", updatedAt: "" };
}

/**
 * Retrieve a specific fact by category + key.
 */
export function getFact(category: FactCategory, key: string): Fact | undefined {
  return statements().getByKeyStmt.get(category, key) as Fact | undefined;
}

/**
 * Get all facts in a category.
 */
export function getFactsByCategory(category: FactCategory): Fact[] {
  return statements().getByCategoryStmt.all(category) as Fact[];
}

/**
 * Search facts by key or value substring.
 */
export function searchFacts(query: string, limit = 20): Fact[] {
  const q = `%${query}%`;
  return statements().searchStmt.all(q, q, limit) as Fact[];
}

/**
 * Get all stored facts. Useful for building user profile context.
 */
export function getAllFacts(): Fact[] {
  return statements().allStmt.all() as Fact[];
}

/**
 * Delete a specific fact.
 */
export function deleteFact(id: string): boolean {
  const result = statements().deleteStmt.run(id);
  return result.changes > 0;
}

/**
 * Build a text summary of all known facts about the user.
 * Used to inject into system prompts for personalization.
 */
export function buildUserProfile(): string {
  const facts = getAllFacts();
  if (facts.length === 0) return "No known facts about the user yet.";

  const grouped = new Map<string, Fact[]>();
  for (const f of facts) {
    const arr = grouped.get(f.category) ?? [];
    arr.push(f);
    grouped.set(f.category, arr);
  }

  const sections: string[] = [];
  for (const [category, items] of grouped) {
    sections.push(`[${category.toUpperCase()}]`);
    for (const item of items) {
      sections.push(`  ${item.key}: ${item.value}`);
    }
  }

  return sections.join("\n");
}
