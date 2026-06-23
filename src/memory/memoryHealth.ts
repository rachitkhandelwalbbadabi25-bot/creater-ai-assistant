// src/memory/memoryHealth.ts — Memory Health Monitor
import { getDB } from "./db.js";
import { getGraphStats } from "./graph.js";
import { getCacheStats } from "./cache.js";

export interface MemoryHealthReport {
  status: "healthy" | "degraded" | "critical";
  totalMemories: number;
  totalGraphNodes: number;
  totalGraphEdges: number;
  duplicatePercentage: number;
  archivePercentage: number;
  cacheHitRatio: number;
  avgRetrievalMs: number;
}

export function getMemoryStats() {
  const db = getDB();
  const graph = getGraphStats();

  const totalFacts = db.prepare("SELECT COUNT(*) as count FROM facts").get() as any;
  const totalTimeline = db.prepare("SELECT COUNT(*) as count FROM timeline_events").get() as any;
  const totalArchived = db.prepare("SELECT COUNT(*) as count FROM memory_archives").get() as any;

  return {
    facts: totalFacts.count,
    timeline: totalTimeline.count,
    archived: totalArchived.count,
    nodes: graph.nodeCount,
    edges: graph.edgeCount
  };
}

export function detectDuplicateMemories(): number {
  const db = getDB();
  const facts = db.prepare("SELECT value, COUNT(*) as count FROM facts GROUP BY value HAVING count > 1").all() as any[];
  return facts.length;
}

export function detectGraphExplosion(): boolean {
  const stats = getGraphStats();
  // An explosion is defined if the ratio of edges to nodes is extremely high (e.g., density > 20 edges per node)
  if (stats.nodeCount === 0) return false;
  return (stats.edgeCount / stats.nodeCount) > 20;
}

export function detectOversizedContext(payloadChars: number): boolean {
  return payloadChars >= 8000;
}

export function detectUnusedNodes(): number {
  const db = getDB();
  // Nodes with 0 access count and updated more than 15 days ago
  const rows = db.prepare(`
    SELECT COUNT(*) as count FROM memory_nodes
    WHERE access_count = 0
      AND datetime(updated_at) < datetime('now', '-15 days')
  `).get() as any;
  return rows.count;
}

export function generateHealthReport(avgRetrievalMs = 50): MemoryHealthReport {
  const stats = getMemoryStats();
  const duplicates = detectDuplicateMemories();
  const totalItems = stats.facts + stats.timeline;
  const duplicatePercentage = totalItems === 0 ? 0 : duplicates / totalItems;
  const archivePercentage = (totalItems + stats.archived) === 0 ? 0 : stats.archived / (totalItems + stats.archived);

  // Calculate overall cache hit ratio from stats
  const cStats = getCacheStats();
  let hits = 0;
  let total = 0;
  for (const cache of Object.values(cStats)) {
    hits += cache.hits;
    total += cache.hits + cache.misses;
  }
  const cacheHitRatio = total === 0 ? 1.0 : hits / total;

  let status: MemoryHealthReport["status"] = "healthy";
  if (duplicatePercentage > 0.15 || avgRetrievalMs > 300) {
    status = "degraded";
  }
  if (avgRetrievalMs > 500) {
    status = "critical";
  }

  return {
    status,
    totalMemories: totalItems,
    totalGraphNodes: stats.nodes,
    totalGraphEdges: stats.edges,
    duplicatePercentage,
    archivePercentage,
    cacheHitRatio,
    avgRetrievalMs
  };
}
