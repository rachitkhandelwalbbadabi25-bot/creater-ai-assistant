import type { FactCategory } from "./longTerm.js";

export interface ParsedMemoryStore {
  category: FactCategory;
  key: string;
  value: string;
}

export function parseMemoryStoreInput(input: string): ParsedMemoryStore | null {
  const raw = input.trim();
  if (!raw) return null;

  // Match "remember that..." or "remember..."
  const match = raw.match(/^(?:please\s+|kindly\s+)?remember\s+(?:that\s+)?(.+)$/i);
  if (!match) return null;

  const body = match[1]!.trim();
  if (!body) return null;

  // Do not match retrieval queries like "remember earlier" or "remember previous tasks"
  if (/^(?:earlier|before|previous|tasks?|what|how|why)$/i.test(body)) {
    return null;
  }

  // 1. Name: "my name is Rachit" / "I am Rachit"
  const nameMatch = body.match(/^(?:my\s+name\s+is|i\s+am)\s+([A-Za-z0-9_\s]+)$/i);
  if (nameMatch) {
    const val = nameMatch[1]!.trim();
    return { category: "person", key: "user_name", value: val };
  }

  // 2. Preferences: "I prefer dark mode" / "I like TS"
  const prefMatch = body.match(/^i\s+(?:prefer|like|love|want)\s+(.+)$/i);
  if (prefMatch) {
    const val = prefMatch[1]!.trim();
    return { category: "preference", key: "preference", value: val };
  }

  // 3. Creator / Fact: "I created Creater AI"
  const creatorMatch = body.match(/^i\s+(?:created|built|made)\s+(.+)$/i);
  if (creatorMatch) {
    const val = creatorMatch[1]!.trim();
    return { category: "fact", key: "created_project", value: val };
  }

  // 4. Generic Fact: "remember X"
  const cleanKey = body
    .toLowerCase()
    .replace(/[^a-z0-9_\s]/g, "")
    .split(/\s+/)
    .slice(0, 4)
    .join("_");

  return {
    category: "fact",
    key: cleanKey || "general_fact",
    value: body,
  };
}

export function isMemoryListInput(input: string): boolean {
  const normalized = input.trim().toLowerCase();
  return (
    normalized === "what do you remember about me" ||
    normalized === "what do you remember about me?" ||
    normalized === "what facts do you know about me" ||
    normalized === "what facts do you know about me?" ||
    normalized === "list my facts" ||
    normalized === "show my memory" ||
    normalized === "what do you know about me" ||
    normalized === "what do you know about me?"
  );
}

export function parseMemoryQueryInput(input: string): string | null {
  const raw = input.trim().replace(/[?!.,]+$/g, "");
  if (!raw) return null;

  // e.g. "what is my favorite programming language", "tell me what is my favorite food", "what do you remember about my stack", "meri favorite programming language kya hai"
  const patterns = [
    /^(?:(?:can\s+you\s+)?(?:tell|batao|batana)\s+(?:me\s+)?)?(?:what(?:'s|\s+is)\s+my|what\s+do\s+you\s+remember\s+about\s+(?:my\s+)?|do\s+you\s+remember\s+(?:my\s+)?)\s+(.+)$/i,
    /^(?:(?:can\s+you\s+)?(?:tell|batao|batana)\s+(?:me\s+)?)?(?:mera|meri)\s+(.+?)(?:\s+(?:kya\s+hai|hai))?$/i,
    /^(?:what(?:'s|\s+is))\s+(.+?)\s+according\s+to\s+your\s+memory$/i,
  ];

  for (const p of patterns) {
    const match = raw.match(p);
    if (match && match[1]) {
      const target = match[1].trim();
      // Avoid matching non-memory system questions
      if (!/^(?:active\s+window|screen|ip|time|date|battery|volume)$/i.test(target)) {
        return target;
      }
    }
  }

  return null;
}
