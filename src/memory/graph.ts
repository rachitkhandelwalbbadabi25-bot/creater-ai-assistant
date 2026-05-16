// ════════════════════════════════════════════════════════════════════════════════
// src/memory/graph.ts — Personal Knowledge Graph engine
//
// Architecture:
//   - Nodes: entities (person, preference, project, habit, topic, skill, emotion)
//   - Edges: typed directed relationships (likes, uses, works_on, related_to …)
//   - Auto-link: new facts infer graph edges automatically
//   - Archive: low-importance, stale nodes get soft-archived
// ════════════════════════════════════════════════════════════════════════════════

import { db } from "./db.js";
import { createLogger } from "@utils/logger.js";
import { generateId } from "@utils/helpers.js";

const log = createLogger("memory/graph");

// ─── Types ─────────────────────────────────────────────────────────────────────
export type NodeType =
  | "person"
  | "preference"
  | "project"
  | "habit"
  | "topic"
  | "emotion"
  | "skill"
  | "tool";

export type EdgeRelation =
  | "likes"
  | "dislikes"
  | "uses"
  | "works_on"
  | "knows"
  | "has_habit"
  | "prefers"
  | "related_to"
  | "learned"
  | "avoids";

export interface MemoryNode {
  id: string;
  type: NodeType;
  label: string;
  description: string | null;
  tags: string[];
  importance: number;
  access_count: number;
  last_accessed: string | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryEdge {
  id: string;
  from_id: string;
  to_id: string;
  relation: EdgeRelation;
  weight: number;
  context: string | null;
  created_at: string;
}

export interface NodeWithEdges extends MemoryNode {
  edges: Array<{ relation: EdgeRelation; weight: number; target: MemoryNode }>;
}

// ─── Prepared Statements ────────────────────────────────────────────────────────
const insertNode = db.prepare(`
  INSERT INTO memory_nodes (id, type, label, description, tags, importance)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO NOTHING
`);

const upsertNodeByLabel = db.prepare(`
  INSERT INTO memory_nodes (id, type, label, description, tags, importance)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(label) DO UPDATE SET
    description = COALESCE(excluded.description, description),
    importance  = MAX(importance, excluded.importance),
    access_count = access_count + 1,
    last_accessed = datetime('now'),
    updated_at  = datetime('now')
  RETURNING *
`);

const upsertEdge = db.prepare(`
  INSERT INTO memory_edges (id, from_id, to_id, relation, weight, context)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(from_id, to_id, relation) DO UPDATE SET
    weight  = MAX(weight, excluded.weight),
    context = COALESCE(excluded.context, context)
  RETURNING *
`);

const getNodeById = db.prepare(`SELECT * FROM memory_nodes WHERE id = ?`);
const getNodeByLabel = db.prepare(`SELECT * FROM memory_nodes WHERE label = ? COLLATE NOCASE`);
const getNodesByType = db.prepare(`SELECT * FROM memory_nodes WHERE type = ? ORDER BY importance DESC, access_count DESC`);
const getAllNodes = db.prepare(`SELECT * FROM memory_nodes ORDER BY importance DESC, access_count DESC`);
const getEdgesFrom = db.prepare(`SELECT * FROM memory_edges WHERE from_id = ?`);
const getEdgesTo = db.prepare(`SELECT * FROM memory_edges WHERE to_id = ?`);
const searchNodes = db.prepare(`
  SELECT * FROM memory_nodes
  WHERE label LIKE ? OR description LIKE ? OR tags LIKE ?
  ORDER BY importance DESC LIMIT ?
`);
const topNodes = db.prepare(`SELECT * FROM memory_nodes ORDER BY importance DESC, access_count DESC LIMIT ?`);
const archiveLowImportance = db.prepare(`
  SELECT * FROM memory_nodes
  WHERE importance < 0.2
    AND (last_accessed IS NULL OR datetime(last_accessed) < datetime('now', '-30 days'))
`);
const deleteNode = db.prepare(`DELETE FROM memory_nodes WHERE id = ?`);
const insertArchive = db.prepare(`
  INSERT INTO memory_archives (id, original_id, type, label, description)
  VALUES (?, ?, ?, ?, ?)
`);
const getStats = db.prepare(`
  SELECT 
    (SELECT COUNT(*) FROM memory_nodes) as nodeCount,
    (SELECT COUNT(*) FROM memory_edges) as edgeCount,
    (SELECT COUNT(*) FROM memory_archives) as archivedCount
`);

// ─── Helpers ────────────────────────────────────────────────────────────────────
function parseNode(raw: any): MemoryNode {
  return {
    ...raw,
    tags: (() => { try { return JSON.parse(raw.tags || "[]"); } catch { return []; } })(),
  };
}

// ─── Core CRUD ──────────────────────────────────────────────────────────────────

/**
 * Add or update a node. Uses label as the natural key.
 * Returns the resolved node (existing or newly created).
 */
export function upsertNode(
  type: NodeType,
  label: string,
  description?: string,
  tags: string[] = [],
  importance = 0.5
): MemoryNode {
  const id = generateId();
  const rows = upsertNodeByLabel.all(
    id, type, label, description ?? null, JSON.stringify(tags), importance
  ) as any[];
  const row = rows[0] ?? getNodeByLabel.get(label);
  if (!row) throw new Error(`Graph: failed to upsert node "${label}"`);
  log.mem(`Node upserted: [${type}] ${label}`);
  return parseNode(row);
}

/**
 * Link two nodes with a typed, weighted relationship.
 * If the edge already exists, its weight is bumped to the max.
 */
export function linkNodes(
  fromLabel: string,
  relation: EdgeRelation,
  toLabel: string,
  context?: string,
  weight = 1.0
): MemoryEdge | null {
  const from = getNodeByLabel.get(fromLabel) as any;
  const to = getNodeByLabel.get(toLabel) as any;
  if (!from || !to) {
    log.warn(`Graph: cannot link "${fromLabel}" → "${toLabel}" — one or both nodes missing`);
    return null;
  }

  const rows = upsertEdge.all(generateId(), from.id, to.id, relation, weight, context ?? null) as any[];
  const edge = rows[0];
  log.mem(`Edge: "${fromLabel}" —[${relation}]→ "${toLabel}"`);
  return edge ?? null;
}

/**
 * Get a node and all its outgoing relationships with resolved targets.
 */
export function getNodeWithEdges(label: string): NodeWithEdges | null {
  const rawNode = getNodeByLabel.get(label) as any;
  if (!rawNode) return null;

  const node = parseNode(rawNode);
  const rawEdges = getEdgesFrom.all(node.id) as any[];

  const edges = rawEdges
    .map(e => {
      const target = getNodeById.get(e.to_id) as any;
      if (!target) return null;
      return { relation: e.relation as EdgeRelation, weight: e.weight, target: parseNode(target) };
    })
    .filter(Boolean) as NodeWithEdges["edges"];

  return { ...node, edges };
}

/**
 * Full-text search across labels, descriptions, and tags.
 */
export function searchGraph(query: string, limit = 20): MemoryNode[] {
  const q = `%${query}%`;
  return (searchNodes.all(q, q, q, limit) as any[]).map(parseNode);
}

/**
 * Get all nodes of a specific type.
 */
export function getNodesByTypeOf(type: NodeType): MemoryNode[] {
  return (getNodesByType.all(type) as any[]).map(parseNode);
}

/**
 * Get top N most important / frequently accessed nodes.
 */
export function getTopNodes(n = 10): MemoryNode[] {
  return (topNodes.all(n) as any[]).map(parseNode);
}

/**
 * Get complete graph stats.
 */
export function getGraphStats(): { nodeCount: number; edgeCount: number; archivedCount: number } {
  return getStats.get() as any;
}

// ─── Smart Auto-Link ─────────────────────────────────────────────────────────────
/**
 * Given a new fact (key + value), automatically create graph nodes and infer edges.
 *
 * Examples:
 *   ("preference", "theme", "dark mode")
 *     → node[preference: "dark mode"] + edge[user →[prefers]→ dark mode]
 *
 *   ("person", "best_friend", "Arjun")
 *     → node[person: "Arjun"] + edge[user →[knows]→ Arjun]
 */
export function autoLinkFact(
  category: string,
  key: string,
  value: string
): void {
  // Always ensure the "user" root node exists
  upsertNode("person", "User", "The primary user", [], 1.0);

  let nodeType: NodeType = "topic";
  let relation: EdgeRelation = "related_to";

  switch (category) {
    case "preference": nodeType = "preference"; relation = "prefers"; break;
    case "person":     nodeType = "person";     relation = "knows";   break;
    case "project":    nodeType = "project";    relation = "works_on"; break;
    case "habit":      nodeType = "habit";      relation = "has_habit"; break;
    case "skill":      nodeType = "skill";      relation = "learned"; break;
    default:           nodeType = "topic";      relation = "related_to";
  }

  // Create the value node
  upsertNode(nodeType, value, `${key}: ${value}`, [category, key], 0.6);

  // Link user → value
  linkNodes("User", relation, value, `From fact: ${category}.${key}`);

  // Also create a key concept node if meaningful
  if (key.length > 3 && key !== value.toLowerCase()) {
    upsertNode("topic", key, `Concept: ${key}`, [category], 0.3);
    linkNodes(value, "related_to", key, `Key: ${key}`);
  }

  log.mem(`Auto-linked fact [${category}] ${key}="${value}" → graph`);
}

// ─── Smart Inference ─────────────────────────────────────────────────────────────
/**
 * For a node, infer additional links from existing knowledge.
 * e.g., "dark mode" → finds "dark themes" and links them via "related_to".
 */
export function inferLinks(nodeLabel: string): number {
  const related = searchGraph(nodeLabel, 10);
  let linksCreated = 0;
  for (const node of related) {
    if (node.label !== nodeLabel) {
      const edge = linkNodes(nodeLabel, "related_to", node.label, "inferred", 0.4);
      if (edge) linksCreated++;
    }
  }
  return linksCreated;
}

// ─── Archive / Cleanup ──────────────────────────────────────────────────────────
/**
 * Archive stale, low-importance nodes (importance < 0.2 + not accessed in 30+ days).
 * Returns count of archived nodes.
 */
export function archiveStaleNodes(): number {
  const stale = archiveLowImportance.all() as any[];
  let count = 0;
  for (const node of stale) {
    insertArchive.run(generateId(), node.id, node.type, node.label, node.description);
    deleteNode.run(node.id);
    count++;
  }
  if (count > 0) log.mem(`Archived ${count} stale nodes`);
  return count;
}

// ─── Graph Summary (for prompts) ────────────────────────────────────────────────
/**
 * Build a compact text summary of the graph for injection into LLM system prompts.
 */
export function buildGraphContext(maxNodes = 15): string {
  const nodes = getTopNodes(maxNodes);
  if (nodes.length === 0) return "No personal knowledge graph entries yet.";

  const lines: string[] = ["[KNOWLEDGE GRAPH]"];
  for (const node of nodes) {
    const rawEdges = getEdgesFrom.all(node.id) as any[];
    if (rawEdges.length === 0) {
      lines.push(`• ${node.type}:${node.label}`);
    } else {
      const edgeStrs = rawEdges
        .slice(0, 3)
        .map(e => {
          const target = getNodeById.get(e.to_id) as any;
          return target ? `—[${e.relation}]→ ${target.label}` : null;
        })
        .filter(Boolean)
        .join(", ");
      lines.push(`• ${node.type}:${node.label} ${edgeStrs}`);
    }
  }
  return lines.join("\n");
}
