// ════════════════════════════════════════════════════════════════════════════════
// src/memory/retriever.ts — Unified memory retrieval across all tiers (RAG)
// ════════════════════════════════════════════════════════════════════════════════

import { getRecentMessages } from "./shortTerm.js";
import { getTopSummaries, searchSummaries } from "./midTerm.js";
import { searchFacts, buildUserProfile } from "./longTerm.js";
import { search as vectorSearch } from "./vector.js";
import { createLogger } from "@utils/logger.js";
import type { MemoryContext } from "@utils/contextBuilder.js";

const log = createLogger("memory/retriever");

export interface RetrievalOptions {
  /** User's current query/message — used for semantic search */
  query: string;
  /** Max recent messages to include */
  recentMessageCount?: number;
  /** Max semantic search results */
  semanticResultCount?: number;
  /** Include user profile facts */
  includeProfile?: boolean;
  /** Include tasks/deadlines */
  includeTasks?: boolean;
}

/**
 * Unified memory retrieval — queries all memory tiers and assembles a MemoryContext.
 *
 * Retrieval hierarchy:
 * 1. Short-term: recent conversation messages (for continuity)
 * 2. Vector store: semantically relevant past memories (RAG)
 * 3. Mid-term: topic-matched summaries
 * 4. Long-term: relevant facts and user profile
 */
export async function retrieveContext(
  options: RetrievalOptions
): Promise<MemoryContext> {
  const {
    query,
    recentMessageCount = 10,
    semanticResultCount = 5,
    includeProfile = true,
    includeTasks = false,
  } = options;

  log.mem(`Retrieving context for: "${query.slice(0, 80)}"`);

  // ── 1. Short-term: recent conversation ──────────────────────────────────────
  const recentMsgs = getRecentMessages(recentMessageCount);
  const recentMessages = recentMsgs
    .reverse() // chronological order
    .map((m) => `${m.role === "user" ? "User" : "Creater"}: ${m.content}`);

  // ── 2. Semantic search in vector store ──────────────────────────────────────
  let relevantMemories: string[] = [];
  try {
    const vectorResults = await vectorSearch(query, semanticResultCount, 0.35);
    relevantMemories = vectorResults.map(
      (r) => `[${(r.score * 100).toFixed(0)}% match] ${r.entry.text}`
    );
  } catch (e) {
    log.warn("Vector search failed — continuing without semantic results", {
      error: String(e),
    });
  }

  // ── 3. Mid-term: keyword search in summaries ───────────────────────────────
  const keywords = extractKeywords(query);
  if (keywords.length > 0) {
    const summaryResults = searchSummaries(keywords[0]!, 3);
    for (const s of summaryResults) {
      relevantMemories.push(`[summary] ${s.content}`);
    }
  }

  // ── 4. Long-term: fact search ──────────────────────────────────────────────
  if (includeProfile) {
    const factResults = searchFacts(query, 5);
    for (const f of factResults) {
      relevantMemories.push(`[fact:${f.category}] ${f.key}: ${f.value}`);
    }
  }

  // ── 5. Deduplicate and limit ───────────────────────────────────────────────
  relevantMemories = [...new Set(relevantMemories)].slice(0, 15);

  const context: MemoryContext = {
    recentMessages,
    relevantMemories,
    activeProjects: [],
    pendingTasks: [],
    upcomingDeadlines: [],
  };

  log.mem(`Retrieved context: ${recentMessages.length} recent, ${relevantMemories.length} relevant`);

  return context;
}

/**
 * Quick retrieval — just recent messages, no semantic search.
 * Used for fast operations like routing.
 */
export function retrieveQuickContext(messageCount = 5): MemoryContext {
  const recent = getRecentMessages(messageCount);
  return {
    recentMessages: recent.reverse().map((m) => `${m.role}: ${m.content}`),
    relevantMemories: [],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────────
/**
 * Extract simple keywords from a query for fallback text search.
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "in", "on", "at", "to",
    "for", "of", "with", "and", "or", "but", "not", "this", "that", "it",
    "i", "me", "my", "you", "your", "we", "our", "he", "she", "they",
    "do", "did", "does", "have", "has", "had", "will", "would", "can",
    "could", "should", "may", "might", "what", "how", "when", "where",
    "why", "who", "which", "kya", "kaise", "kab", "kyun", "kahan",
    "hai", "hain", "tha", "thi", "ho", "kar", "mein", "ko", "se", "ka",
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}
