// src/intelligence/experienceMemory.ts
/**
 * In‑memory Experience Memory Engine
 * Stores up to 10,000 experiences using a FIFO eviction policy.
 * Provides APIs to record, retrieve, and find similar experiences.
 */

type Experience = {
  id: string;
  timestamp: number; // epoch ms
  success: boolean;
  toolName: string;
  details: Record<string, any>;
  userPreferences?: Record<string, any>;
};

const MAX_EXPERIENCES = 10000;
let store: Experience[] = [];

/** Generate a short unique identifier */
function generateId(): string {
  // Simple base‑36 ID; sufficient for in‑memory use.
  return Math.random().toString(36).substring(2, 10);
}

/** Redact sensitive fields in a details object */
function redact(details: Record<string, any>): Record<string, any> {
  const redacted = { ...details };
  if ("password" in redacted) redacted["password"] = "[REDACTED]";
  if ("apiKey" in redacted) redacted["apiKey"] = "[REDACTED]";
  return redacted;
}

/** Record a new experience.
 * @param params Partial experience data.
 * @returns The stored Experience object.
 */
export function recordExperience(params: {
  success: boolean;
  toolName: string;
  details: Record<string, any>;
  userPreferences?: Record<string, any>;
}): Experience {
  const entry: Experience = {
    id: generateId(),
    timestamp: Date.now(),
    success: params.success,
    toolName: params.toolName,
    details: redact(params.details),
    userPreferences: params.userPreferences,
  };

  // FIFO eviction – if we exceed the limit, remove oldest entry.
  if (store.length >= MAX_EXPERIENCES) {
    store.shift(); // drop the oldest (FIFO)
  }
  store.push(entry);
  return entry;
}

/** Retrieve all stored experiences, newest first. */
export function getExperiences(): Experience[] {
  return [...store].sort((a, b) => b.timestamp - a.timestamp);
}

/** Find experiences similar to a query.
 * Simple similarity based on matching toolName and overlapping detail keys.
 */
export function findSimilarExperience(
  query: { toolName: string; details?: Record<string, any> },
  maxResults: number = 5,
): Experience[] {
  const matches = store.filter((exp) => {
    if (exp.toolName !== query.toolName) return false;
    if (!query.details) return true;
    const queryKeys = Object.keys(query.details);
    const expKeys = Object.keys(exp.details);
    const common = queryKeys.filter((k) => expKeys.includes(k)).length;
    // Consider a match when at least half the queried keys appear.
    return common >= Math.ceil(queryKeys.length / 2);
  });
  return matches
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, maxResults);
}

/** Clear all stored experiences – useful for testing. */
export function clearExperiences(): void {
  store = [];
}

/** Load experiences (alias for getExperiences) – kept for backward compatibility. */
export function loadExperiences(): Experience[] {
  return getExperiences();
}

export type { Experience };
