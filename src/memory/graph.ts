// src/memory/graph.ts — Personal Knowledge Graph engine
//
// Architecture:
//   - Nodes: entities (person, preference, project, habit, topic, skill, emotion, tool)
//   - Edges: typed directed relationships (likes, uses, works_on, related_to …)
//   - Auto-link: new facts infer graph edges automatically
//   - Archive: low-importance, stale nodes get soft-archived

import { getDB } from "./db.js";
import { createLogger } from "@utils/logger.js";
import { generateId } from "@utils/helpers.js";
import { setCached, getCached, invalidateCache } from "./cache.js";

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
  confidence: number;
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
  confidence: number;
  context: string | null;
  created_at: string;
}

export interface NodeWithEdges extends MemoryNode {
  edges: Array<{ relation: EdgeRelation; weight: number; confidence: number; target: MemoryNode }>;
}

// ─── Prepared Statements Cache ──────────────────────────────────────────────────
let preparedStatements: any = null;

function statements() {
  if (!preparedStatements) {
    const db = getDB();
    preparedStatements = {
      insertNode: db.prepare(`
        INSERT INTO memory_nodes (id, type, label, description, tags, importance, confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `),
      upsertNodeByLabel: db.prepare(`
        INSERT INTO memory_nodes (id, type, label, description, tags, importance, confidence)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(label) DO UPDATE SET
          description = COALESCE(excluded.description, description),
          importance  = MAX(importance, excluded.importance),
          confidence  = MAX(confidence, excluded.confidence),
          access_count = access_count + 1,
          last_accessed = datetime('now'),
          updated_at  = datetime('now')
        RETURNING *
      `),
      upsertEdge: db.prepare(`
        INSERT INTO memory_edges (id, from_id, to_id, relation, weight, confidence, context)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(from_id, to_id, relation) DO UPDATE SET
          weight  = MAX(weight, excluded.weight),
          confidence = MAX(confidence, excluded.confidence),
          context = COALESCE(excluded.context, context)
        RETURNING *
      `),
      getNodeById: db.prepare(`SELECT * FROM memory_nodes WHERE id = ?`),
      getNodeByLabel: db.prepare(`SELECT * FROM memory_nodes WHERE label = ? COLLATE NOCASE`),
      getNodesByType: db.prepare(`SELECT * FROM memory_nodes WHERE type = ? ORDER BY importance DESC, access_count DESC`),
      getAllNodes: db.prepare(`SELECT * FROM memory_nodes ORDER BY importance DESC, access_count DESC`),
      getEdgesFrom: db.prepare(`SELECT * FROM memory_edges WHERE from_id = ?`),
      getEdgesTo: db.prepare(`SELECT * FROM memory_edges WHERE to_id = ?`),
      searchNodes: db.prepare(`
        SELECT * FROM memory_nodes
        WHERE label LIKE ? OR description LIKE ? OR tags LIKE ?
        ORDER BY importance DESC LIMIT ?
      `),
      topNodes: db.prepare(`SELECT * FROM memory_nodes ORDER BY importance DESC, access_count DESC LIMIT ?`),
      archiveLowImportance: db.prepare(`
        SELECT * FROM memory_nodes
        WHERE importance < 0.2
          AND (last_accessed IS NULL OR datetime(last_accessed) < datetime('now', '-30 days'))
      `),
      deleteNode: db.prepare(`DELETE FROM memory_nodes WHERE id = ?`),
      insertArchive: db.prepare(`
        INSERT INTO memory_archives (id, original_id, type, label, description)
        VALUES (?, ?, ?, ?, ?)
      `),
      getStats: db.prepare(`
        SELECT 
          (SELECT COUNT(*) FROM memory_nodes) as nodeCount,
          (SELECT COUNT(*) FROM memory_edges) as edgeCount,
          (SELECT COUNT(*) FROM memory_archives) as archivedCount
      `),
    };
  }
  return preparedStatements;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────
function parseNode(raw: any): MemoryNode {
  return {
    ...raw,
    tags: (() => { try { return JSON.parse(raw.tags || "[]"); } catch { return []; } })(),
    confidence: raw.confidence ?? 1.0,
    access_count: raw.access_count ?? 0,
    last_accessed: raw.last_accessed ?? null
  };
}

// ─── Core CRUD ──────────────────────────────────────────────────────────────────

export function upsertNode(
  type: NodeType,
  label: string,
  description?: string,
  tags: string[] = [],
  importance = 0.5,
  confidence = 1.0
): MemoryNode {
  const id = generateId();
  const { upsertNodeByLabel, getNodeByLabel } = statements();
  const rows = upsertNodeByLabel.all(
    id, type, label, description ?? null, JSON.stringify(tags), importance, confidence
  ) as any[];
  const row = rows[0] ?? getNodeByLabel.get(label);
  if (!row) throw new Error(`Graph: failed to upsert node "${label}"`);
  
  // Invalidate cache
  invalidateCache("graph");
  
  log.mem(`Node upserted: [${type}] ${label}`);
  return parseNode(row);
}

export function linkNodes(
  fromLabel: string,
  relation: EdgeRelation,
  toLabel: string,
  context?: string,
  weight = 1.0,
  confidence = 1.0
): MemoryEdge | null {
  const { getNodeByLabel, upsertEdge } = statements();
  const from = getNodeByLabel.get(fromLabel) as any;
  const to = getNodeByLabel.get(toLabel) as any;
  if (!from || !to) {
    log.warn(`Graph: cannot link "${fromLabel}" → "${toLabel}" — one or both nodes missing`);
    return null;
  }

  const rows = upsertEdge.all(generateId(), from.id, to.id, relation, weight, confidence, context ?? null) as any[];
  const edge = rows[0];

  // Invalidate cache
  invalidateCache("graph");

  log.mem(`Edge: "${fromLabel}" —[${relation}]→ "${toLabel}"`);
  return edge ?? null;
}

export function getNodeWithEdges(label: string): NodeWithEdges | null {
  const cacheKey = `nodeWithEdges:${label}`;
  const cached = getCached<NodeWithEdges>("graph", cacheKey);
  if (cached) return cached;

  const { getNodeByLabel, getEdgesFrom, getNodeById } = statements();
  const rawNode = getNodeByLabel.get(label) as any;
  if (!rawNode) return null;

  const node = parseNode(rawNode);
  const rawEdges = getEdgesFrom.all(node.id) as any[];

  const edges = rawEdges
    .map(e => {
      const target = getNodeById.get(e.to_id) as any;
      if (!target) return null;
      return {
        relation: e.relation as EdgeRelation,
        weight: e.weight,
        confidence: e.confidence ?? 1.0,
        target: parseNode(target)
      };
    })
    .filter(Boolean) as NodeWithEdges["edges"];

  const result = { ...node, edges };
  setCached("graph", cacheKey, result);
  return result;
}

// ─── Multi-Hop traversal & scoring (Phase 5.1) ──────────────────────────────────

export function findRelatedMemories(startLabel: string, maxDepth = 2): NodeWithEdges[] {
  const visited = new Set<string>();
  const queue: Array<{ label: string; depth: number }> = [{ label: startLabel, depth: 0 }];
  const results: NodeWithEdges[] = [];

  while (queue.length > 0) {
    const { label, depth } = queue.shift()!;
    if (visited.has(label)) continue;
    visited.add(label);

    const node = getNodeWithEdges(label);
    if (!node) continue;

    if (label !== startLabel) {
      results.push(node);
    }

    if (depth < maxDepth) {
      for (const edge of node.edges) {
        if (!visited.has(edge.target.label)) {
          queue.push({ label: edge.target.label, depth: depth + 1 });
        }
      }
    }
  }

  return results;
}

export function expandContext(query: string, maxNodes = 5, depth = 2): string {
  const cacheKey = `expandContext:${query}:${maxNodes}:${depth}`;
  const cached = getCached<string>("graph", cacheKey);
  if (cached) return cached;

  const searchResults = searchGraph(query, 3);
  if (searchResults.length === 0) return "";

  const rootLabel = searchResults[0]!.label;
  const related = findRelatedMemories(rootLabel, depth);

  // Score nodes using importance + confidence
  const scoredNodes = related
    .map(node => {
      const score = (node.importance * 0.5) + (node.confidence * 0.5);
      return { node, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxNodes)
    .map(item => item.node);

  let contextParts: string[] = [];

  const rootNode = getNodeWithEdges(rootLabel);
  if (rootNode) {
    const rootEdgeStr = rootNode.edges.map(e => `-[${e.relation}]-> ${e.target.label}`).join(", ");
    contextParts.push(`Root Entity: ${rootNode.label} (${rootNode.type}) info: ${rootNode.description ?? ""} connections: ${rootEdgeStr}`);
  }

  scoredNodes.forEach(node => {
    const edgeStr = node.edges.map(e => `-[${e.relation}]-> ${e.target.label}`).join(", ");
    contextParts.push(`Entity: ${node.label} (${node.type}) info: ${node.description ?? ""} connections: ${edgeStr}`);
  });

  const contextStr = contextParts.join("\n");
  setCached("graph", cacheKey, contextStr);
  return contextStr;
}

export function getImportantNodes(limit = 10): MemoryNode[] {
  const { topNodes } = statements();
  return (topNodes.all(limit) as any[]).map(parseNode);
}

export function reinforceRelationship(fromLabel: string, relation: EdgeRelation, toLabel: string, amount = 0.1): void {
  const db = getDB();
  const { getNodeByLabel } = statements();
  const from = getNodeByLabel.get(fromLabel) as any;
  const to = getNodeByLabel.get(toLabel) as any;
  if (!from || !to) return;

  db.prepare(`
    UPDATE memory_edges
    SET weight = MIN(1.0, weight + ?)
    WHERE from_id = ? AND to_id = ? AND relation = ?
  `).run(amount, from.id, to.id, relation);

  invalidateCache("graph");
}

export function decayRelationships(decayFactor = 0.95): void {
  const db = getDB();
  db.prepare(`
    UPDATE memory_edges
    SET weight = weight * ?
  `).run(decayFactor);

  invalidateCache("graph");
}

// ─── Native APIs preserved ──────────────────────────────────────────────────────

export function searchGraph(query: string, limit = 20): MemoryNode[] {
  const q = `%${query}%`;
  return (statements().searchNodes.all(q, q, q, limit) as any[]).map(parseNode);
}

export function getNodesByTypeOf(type: NodeType): MemoryNode[] {
  return (statements().getNodesByType.all(type) as any[]).map(parseNode);
}

export function getTopNodes(n = 10): MemoryNode[] {
  return (statements().topNodes.all(n) as any[]).map(parseNode);
}

export function getGraphStats(): { nodeCount: number; edgeCount: number; archivedCount: number } {
  return statements().getStats.get() as any;
}

export function autoLinkFact(category: string, key: string, value: string): void {
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

  upsertNode(nodeType, value, `${key}: ${value}`, [category, key], 0.6);
  linkNodes("User", relation, value, `From fact: ${category}.${key}`);

  if (key.length > 3 && key !== value.toLowerCase()) {
    upsertNode("topic", key, `Concept: ${key}`, [category], 0.3);
    linkNodes(value, "related_to", key, `Key: ${key}`);
  }

  log.mem(`Auto-linked fact [${category}] ${key}="${value}" → graph`);
}

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

export function archiveStaleNodes(): number {
  const { archiveLowImportance, insertArchive, deleteNode } = statements();
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

export function buildGraphContext(limit = 10): string {
  const topNodes = getTopNodes(limit);
  if (topNodes.length === 0) return "";

  const lines: string[] = ["[PERSONAL KNOWLEDGE GRAPH]"];
  
  for (const node of topNodes) {
    const detail = getNodeWithEdges(node.label);
    if (!detail) continue;

    let nodeStr = `• ${node.label} (${node.type})`;
    if (node.description) nodeStr += `: ${node.description}`;
    lines.push(nodeStr);

    detail.edges.forEach(edge => {
      if (edge.target.label !== "User") {
        lines.push(`  └─[${edge.relation}]─→ ${edge.target.label} (${edge.target.type})`);
      }
    });
  }

  return lines.join("\n");
}
