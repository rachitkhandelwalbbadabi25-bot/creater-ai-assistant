// ════════════════════════════════════════════════════════════════════════════════
// src/memory/summarizer.ts — Conversation summarization and memory consolidation
// ════════════════════════════════════════════════════════════════════════════════

import { chat, type ChatMessage } from "@llm/ollama.js";
import { MEMORY_SUMMARY_PROMPT } from "@llm/prompts.js";
import { Models, GenerationPresets } from "@config/models.js";
import { getRecentMessages, cleanExpired as cleanMessages } from "./shortTerm.js";
import { addSummary } from "./midTerm.js";
import { addEntry } from "./vector.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("memory/summarizer");

/**
 * Summarize a batch of messages into a single mid-term memory entry.
 * Also indexes the summary in the vector store for semantic retrieval.
 *
 * Called periodically (e.g., every 20 messages, or on session end).
 */
export async function summarizeRecentMessages(
  messageCount = 20
): Promise<string | null> {
  const messages = getRecentMessages(messageCount);
  if (messages.length < 5) {
    log.info("Not enough messages to summarize (need at least 5)");
    return null;
  }

  // Format messages into a conversation block
  const conversation = messages
    .reverse()
    .map((m) => `${m.role === "user" ? "User" : "Creater"}: ${m.content}`)
    .join("\n");

  log.info(`Summarizing ${messages.length} messages...`);

  // Ask LLM to summarize
  const llmMessages: ChatMessage[] = [
    { role: "system", content: MEMORY_SUMMARY_PROMPT },
    { role: "user", content: `Conversation to summarize:\n\n${conversation}` },
  ];

  const summary = await chat({
    model: Models.FAST,
    messages: llmMessages,
    options: GenerationPresets.precise,
  });

  if (!summary || summary.length < 10) {
    log.warn("LLM returned empty or too-short summary");
    return null;
  }

  // Detect topic from summary
  const topic = await detectTopic(summary);

  // Store in mid-term memory
  const messageIds = messages.map((m) => m.id);
  const importance = calculateImportance(messages);
  addSummary(summary, messageIds, topic, importance);

  // Also index in vector store for semantic retrieval
  await addEntry(summary, {
    type: "conversation_summary",
    topic,
    messageCount: messages.length,
    dateRange: `${messages[messages.length - 1]?.createdAt} → ${messages[0]?.createdAt}`,
  });

  log.info(`Summary stored: topic="${topic}", importance=${importance.toFixed(2)}`);
  return summary;
}

/**
 * Auto-detect the topic of a summary using the fast model.
 */
async function detectTopic(summary: string): Promise<string> {
  try {
    const response = await chat({
      model: Models.FAST,
      messages: [
        {
          role: "system",
          content:
            "Given a text, output a single short topic label (1-3 words). " +
            "Examples: 'react project', 'career goals', 'daily routine', 'personal health'. " +
            "Output ONLY the label, nothing else.",
        },
        { role: "user", content: summary },
      ],
      options: GenerationPresets.classification,
    });
    return response.trim().toLowerCase().replace(/[^a-z0-9\s]/g, "").slice(0, 50);
  } catch {
    return "general";
  }
}

/**
 * Calculate importance based on message characteristics.
 * Higher importance for: more user messages, emotion-laden, task-related.
 */
function calculateImportance(
  messages: Array<{ role: string; emotion?: string; intent?: string }>
): number {
  let score = 0.5; // base

  const userMsgs = messages.filter((m) => m.role === "user").length;
  if (userMsgs > 10) score += 0.1;

  // Emotional messages are more important
  const emotionalCount = messages.filter((m) => m.emotion && m.emotion !== "neutral").length;
  if (emotionalCount > 3) score += 0.15;

  // Task-related conversations are important
  const taskRelated = messages.filter(
    (m) => m.intent === "task_management" || m.intent === "scheduling"
  ).length;
  if (taskRelated > 2) score += 0.1;

  return Math.min(score, 1.0);
}

/**
 * Periodic memory maintenance job:
 * 1. Summarize old messages
 * 2. Clean expired entries
 */
export async function runMemoryMaintenance(): Promise<void> {
  log.info("Running memory maintenance...");

  // Summarize if there are enough unsummarized messages
  await summarizeRecentMessages(20);

  // Clean expired short-term messages
  cleanMessages();

  log.info("Memory maintenance complete");
}
