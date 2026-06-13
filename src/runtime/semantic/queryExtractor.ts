/*
 * src/runtime/semantic/queryExtractor.ts
 *
 * Extracts a factual query string from user input for the semantic extraction layer.
 * Returns the extracted query or null if none matches.
 */

export interface QueryExtractionResult {
  /** The extracted query phrase without surrounding verbs */
  query: string;
  /** The original matched pattern name (for debugging) */
  patternName: string;
}

// Simple patterns covering common fact‑question forms.
const patterns: Record<string, RegExp> = {
  // e.g., "tell me virat kohli age"
  tellMeAge: /^(?:tell me|what is|who is|show me|find|search for|give me|look up)\s+(.+?)\s+(?:age|birthday|date of birth)$/i,
  // generic definition: "what is AI"
  definition: /^(?:what is|who is|define|explain)\s+(.+)$/i,
  // generic fact: "who is the president of india"
  genericFact: /^(?:who is|what is|give me|show me)\s+(.+)$/i,
};

function cleanQuerySuffixes(input: string): string {
  return input
    .replace(/\s+on\s+(google|youtube)$/i, "")
    .replace(/\s+online$/i, "")
    .trim();
}

/**
 * Attempts to extract the core query from raw input.
 * Returns null when no pattern matches.
 */
export function extractQuery(rawInput: string): QueryExtractionResult | null {
  const cleanedInput = cleanQuerySuffixes(rawInput);
  const trimmed = cleanedInput.trim();
  for (const [name, regex] of Object.entries(patterns)) {
    const match = regex.exec(trimmed);
    if (match && match[1]) {
      return {
        query: match[1].trim(),
        patternName: name,
      };
    }
  }
  return null;
}

