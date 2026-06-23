// src/memory/knowledgeBase.ts — Personal Knowledge Base
import { getDB } from "./db.js";
import { generateId } from "@utils/helpers.js";
import { createLogger } from "@utils/logger.js";
import { setCached, getCached, invalidateCache } from "./cache.js";
import { upsertNode, linkNodes } from "./graph.js";

const log = createLogger("memory/knowledgeBase");

export type KnowledgeCategory =
  | "education"
  | "career"
  | "projects"
  | "health"
  | "finance"
  | "relationships"
  | "preferences"
  | "goals"
  | "skills"
  | "personal_information";

export const ALLOWED_CATEGORIES: KnowledgeCategory[] = [
  "education",
  "career",
  "projects",
  "health",
  "finance",
  "relationships",
  "preferences",
  "goals",
  "skills",
  "personal_information"
];

// Helper to seed categories lazily
function seedCategoriesIfNeeded() {
  const db = getDB();
  const count = db.prepare("SELECT COUNT(*) as count FROM knowledge_categories").get() as any;
  if (count.count === 0) {
    const insert = db.prepare("INSERT INTO knowledge_categories (id, name, description, confidence) VALUES (?, ?, ?, 1.0)");
    for (const cat of ALLOWED_CATEGORIES) {
      insert.run(generateId(), cat, `Structured category for ${cat}`);
    }
    log.info(`Seeded ${ALLOWED_CATEGORIES.length} knowledge categories`);
  }
}

export function categorizeMemory(
  text: string,
  category: KnowledgeCategory,
  confidence = 1.0
): void {
  seedCategoriesIfNeeded();
  const db = getDB();

  // Create fact in facts table
  const key = `knowledge_${category}_${generateId().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO facts (id, category, key, value, confidence, source)
    VALUES (?, ?, ?, ?, ?, 'knowledge_base')
  `).run(generateId(), category, key, text, confidence);

  // Link to graph
  try {
    upsertNode("topic", text, `Knowledge item: ${text}`, [category], 0.6);
    linkNodes("User", "related_to", text, `Category: ${category}`);
  } catch (e) {
    log.warn("Failed to update graph during categorization", { error: String(e) });
  }

  invalidateCache("knowledge", "search");
  log.info(`Categorized memory under [${category}]: ${text.slice(0, 60)}`);
}

export interface KnowledgeRecord {
  id: string;
  category: string;
  key: string;
  value: string;
  confidence: number;
}

export function searchKnowledge(query: string): KnowledgeRecord[] {
  seedCategoriesIfNeeded();
  const cacheKey = `search:${query}`;
  const cached = getCached<KnowledgeRecord[]>("knowledge", cacheKey);
  if (cached) return cached;

  const db = getDB();
  const q = `%${query}%`;
  const rows = db.prepare(`
    SELECT id, category, key, value, confidence FROM facts
    WHERE value LIKE ? AND source = 'knowledge_base'
    ORDER BY confidence DESC
  `).all(q) as any[];

  setCached("knowledge", cacheKey, rows);
  return rows;
}

export function linkKnowledge(
  fromCategory: KnowledgeCategory,
  toCategory: KnowledgeCategory,
  description?: string,
  weight = 1.0,
  confidence = 1.0
): void {
  seedCategoriesIfNeeded();
  const db = getDB();
  const id = generateId();

  db.prepare(`
    INSERT INTO knowledge_links (id, from_category, to_category, description, weight, confidence)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(from_category, to_category) DO UPDATE SET
      weight = excluded.weight,
      confidence = excluded.confidence,
      description = COALESCE(excluded.description, description)
  `).run(id, fromCategory, toCategory, description ?? null, weight, confidence);

  log.info(`Linked knowledge category ${fromCategory} <-> ${toCategory}`);
}

export function retrieveKnowledgeContext(query: string): string {
  const records = searchKnowledge(query);
  if (records.length === 0) return "";
  return records.map(r => `[Category: ${r.category}] (confidence: ${r.confidence}) ${r.value}`).join("\n");
}
