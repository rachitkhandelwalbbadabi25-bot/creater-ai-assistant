// src/runtime/semantic/entityExtractor.ts
/**
 * Very lightweight entity extractor – currently supports simple person‑name detection.
 * It looks for capital‑case words after verbs like "who is" or "tell me about".
 */
export function extractEntities(query: string): Record<string, string> {
  const entities: Record<string, string> = {};
  // Detect a person name pattern – assumes a name is one or two capitalized words.
  const personMatch = /(?:who is|tell me about|show me)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/.exec(query);
  if (personMatch && personMatch[1]) {
    entities["person"] = personMatch[1];
  }
  // Future: add location, organization, date extraction using more patterns or external libs.
  return entities;
}

// Export default for convenience.
export default extractEntities;
