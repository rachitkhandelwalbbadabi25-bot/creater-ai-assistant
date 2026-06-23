// src/llm/tokenBudget.ts
// Adaptive num_predict per intent type.
// Reduces eval_ms for short responses without truncating long ones.

export function getNumPredict(intent: string): number {
  const i = intent.toLowerCase();

  // Greetings and one-liners
  if (i === "chitchat" || i === "conversation" || i === "greeting") return 128;

  // Emotional support — needs warmth but not walls of text
  if (i === "emotion_support" || i === "emotion") return 192;

  // Factual single-answer questions
  if (i === "knowledge_qa" || i === "simple_qa") return 256;

  // Task / scheduling — needs structure but usually brief
  if (i === "task_management" || i === "scheduling") return 256;

  // Memory lookups
  if (i === "memory_query") return 256;

  // Code tasks need room for code blocks
  if (
    i.includes("code") ||
    i.includes("git") ||
    i === "technical_discussion" ||
    i === "project_query"
  )
    return 512;

  // Planning and long-form reasoning
  if (
    i.includes("planning") ||
    i.includes("reasoning") ||
    i.includes("brainstorm") ||
    i === "morning_briefing" ||
    i === "night_check"
  )
    return 1024;

  // System / laptop commands — usually short acknowledgements
  if (
    i === "system_control" ||
    i === "browser_action" ||
    i === "file_operation" ||
    i === "laptop"
  )
    return 192;

  // Default: mid-range
  return 256;
}
