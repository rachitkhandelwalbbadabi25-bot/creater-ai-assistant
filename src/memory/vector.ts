// ════════════════════════════════════════════════════════════════════════════════
// src/memory/vector.ts — Local vector store for semantic memory (embeddings)
// ════════════════════════════════════════════════════════════════════════════════

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { env } from "@config/index.js";
import { embedSingle, embed } from "@llm/ollama.js";
import { createLogger } from "@utils/logger.js";
import { generateId } from "@utils/helpers.js";
import { executeTool } from "../agents/toolExecutor.js";

const log = createLogger("memory/vector");

const metrics = {
  retryCount: 0,
  timeoutCount: 0,
  failedEmbeddings: 0,
  failedVectorWrites: 0,
  totalLatencyMs: 0,
  totalOperations: 0,
};

export function getMemoryMetrics() {
  return {
    retryCount: metrics.retryCount,
    timeoutCount: metrics.timeoutCount,
    failedEmbeddings: metrics.failedEmbeddings,
    failedVectorWrites: metrics.failedVectorWrites,
    averageLatencyMs: metrics.totalOperations > 0 ? metrics.totalLatencyMs / metrics.totalOperations : 0,
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────────
export interface VectorEntry {
  id: string;
  text: string;
  vector: number[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SearchResult {
  entry: VectorEntry;
  score: number; // cosine similarity 0..1
}

// ─── In-Memory Vector Store ───────────────────────────────────────────────────────
// Uses a flat file + in-memory array for simplicity (no external DB needed).
// Scales well up to ~50k entries for a personal assistant.

let entries: VectorEntry[] = [];
const STORE_PATH = join(env.VECTOR_DB_PATH, "vectors.json");

/**
 * Initialize vector store — load from disk if exists.
 */
export function initVectorStore(): void {
  const dir = env.VECTOR_DB_PATH;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    log.info(`Created vector store directory: ${dir}`);
  }

  if (existsSync(STORE_PATH)) {
    try {
      const raw = readFileSync(STORE_PATH, "utf-8");
      entries = JSON.parse(raw) as VectorEntry[];
      log.info(`Loaded ${entries.length} vectors from disk`);
    } catch (e) {
      log.warn("Failed to load vector store — starting fresh", { error: String(e) });
      entries = [];
    }
  }
}

/**
 * Persist current vector store to disk.
 */
export function saveVectorStore(): void {
  try {
    writeFileSync(STORE_PATH, JSON.stringify(entries), "utf-8");
    log.mem(`Saved ${entries.length} vectors to disk`);
  } catch (e) {
    log.error("Failed to persist vector store to disk", {
      success: false,
      operation: "saveVectorStore",
      error: String(e),
    });
  }
}

// ─── Core Operations ──────────────────────────────────────────────────────────────

/**
 * Add a text entry to the vector store (generates embedding via Ollama).
 */
export async function addEntry(
  text: string,
  metadata: Record<string, unknown> = {}
): Promise<VectorEntry> {
  let vector: number[];
  const start = Date.now();
  console.log("[VECTOR_WRITE_START]", "addEntry");
  console.log("[MEMORY_RETRY_START]", "embedSingle");

  const res = await executeTool(
    async () => await embedSingle(text),
    {
      maxAttempts: 3,
      baseDelayMs: 300,
      timeoutMs: 30000,
    }
  );

  const duration = Date.now() - start;
  metrics.totalLatencyMs += duration;
  metrics.totalOperations++;

  if (res.success) {
    console.log("[MEMORY_RETRY_SUCCESS]", "embedSingle");
    console.log("[VECTOR_WRITE_SUCCESS]", "addEntry");
    vector = res.result as number[];
    if (res.attempts > 1) {
      metrics.retryCount += (res.attempts - 1);
    }
  } else {
    console.log("[MEMORY_RETRY_FAILED]", "embedSingle");
    metrics.failedEmbeddings++;
    metrics.failedVectorWrites++;
    if (res.error?.includes("timeout")) {
      metrics.timeoutCount++;
    }
    log.error("Failed to generate embedding for vector entry", {
      success: false,
      operation: "addEntry",
      error: res.error,
    });
    vector = new Array(768).fill(0);
  }
  
  const entry: VectorEntry = {
    id: generateId(),
    text,
    vector,
    metadata,
    createdAt: new Date().toISOString(),
  };

  entries.push(entry);
  log.mem(`Added vector entry`, { id: entry.id, textLen: text.length });

  // Auto-save every 10 entries
  if (entries.length % 10 === 0) saveVectorStore();

  return entry;
}

/**
 * Batch-add multiple texts at once (more efficient — single embed call).
 */
export async function addEntries(
  items: Array<{ text: string; metadata?: Record<string, unknown> }>
): Promise<VectorEntry[]> {
  const texts = items.map((i) => i.text);
  let vectors: number[][];
  const start = Date.now();
  console.log("[VECTOR_WRITE_START]", "addEntries");
  console.log("[MEMORY_RETRY_START]", "embed");

  const res = await executeTool(
    async () => await embed(texts),
    {
      maxAttempts: 3,
      baseDelayMs: 300,
      timeoutMs: 30000,
    }
  );

  const duration = Date.now() - start;
  metrics.totalLatencyMs += duration;
  metrics.totalOperations++;

  if (res.success) {
    console.log("[MEMORY_RETRY_SUCCESS]", "embed");
    console.log("[VECTOR_WRITE_SUCCESS]", "addEntries");
    vectors = res.result as number[][];
    if (res.attempts > 1) {
      metrics.retryCount += (res.attempts - 1);
    }
  } else {
    console.log("[MEMORY_RETRY_FAILED]", "embed");
    metrics.failedEmbeddings++;
    metrics.failedVectorWrites += items.length;
    if (res.error?.includes("timeout")) {
      metrics.timeoutCount++;
    }
    log.error("Failed to generate batch embedding", {
      success: false,
      operation: "addEntries",
      error: res.error,
    });
    vectors = items.map(() => new Array(768).fill(0));
  }

  const newEntries: VectorEntry[] = items.map((item, i) => ({
    id: generateId(),
    text: item.text,
    vector: vectors[i] || new Array(768).fill(0),
    metadata: item.metadata ?? {},
    createdAt: new Date().toISOString(),
  }));

  entries.push(...newEntries);
  saveVectorStore();
  log.mem(`Batch-added ${newEntries.length} vector entries`);

  return newEntries;
}

/**
 * Semantic search — find the most similar entries to a query.
 */
export async function search(
  query: string,
  topK = 5,
  minScore = 0.3
): Promise<SearchResult[]> {
  if (entries.length === 0) return [];

  const start = Date.now();
  console.log("[VECTOR_SEARCH_START]", query);

  const res = await executeTool(
    async () => await embedSingle(query),
    {
      maxAttempts: 2,
      baseDelayMs: 200,
      timeoutMs: 10000,
    }
  );

  const duration = Date.now() - start;
  metrics.totalLatencyMs += duration;
  metrics.totalOperations++;

  let queryVector: number[];
  if (res.success) {
    console.log("[VECTOR_SEARCH_SUCCESS]", query);
    queryVector = res.result as number[];
    if (res.attempts > 1) {
      metrics.retryCount += (res.attempts - 1);
    }
  } else {
    metrics.failedEmbeddings++;
    if (res.error?.includes("timeout")) {
      metrics.timeoutCount++;
    }
    log.error("Failed to generate embedding for search query", {
      success: false,
      operation: "vector_search",
      error: res.error,
    });
    return [];
  }

  const scored: SearchResult[] = entries
    .map((entry) => ({
      entry,
      score: cosineSimilarity(queryVector, entry.vector),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  log.mem(`Vector search: "${query.slice(0, 60)}" → ${scored.length} results`);
  return scored;
}

/**
 * Delete an entry by ID.
 */
export function deleteEntry(id: string): boolean {
  const before = entries.length;
  entries = entries.filter((e) => e.id !== id);
  if (entries.length < before) {
    saveVectorStore();
    return true;
  }
  return false;
}

/**
 * Get total entry count.
 */
export function getEntryCount(): number {
  return entries.length;
}

// ─── Math ─────────────────────────────────────────────────────────────────────────
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
