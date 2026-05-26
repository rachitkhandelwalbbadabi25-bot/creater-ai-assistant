// packages/convo/src/personality/PersonalityRenderer.ts

import { PersonalityProfile } from "../types";

/**
 * PersonalityRenderer – Phase 1 implementation.
 * It takes a plain string response from the reasoning layer and decorates it
 * according to the current {@link PersonalityProfile}.  The logic is simple
 * and deterministic so that later phases can replace it with a richer LLM‑based
 * style engine without changing the public API.
 */
export class PersonalityRenderer {
  /**
   * Render the raw response using the supplied personality profile.
   * If no profile is provided, the text is returned unchanged.
   *
   * The current implementation prefixes the response with the tone in square
   * brackets – e.g. `[friendly] Hello!`.  This makes the effect obvious during
   * development and is easy to replace later.
   */
  render(raw: string, profile?: PersonalityProfile): string {
    if (!profile) return raw;
    const toneTag = `[${profile.tone}]`;
    // Simple concatenation – keep deterministic and side‑effect free.
    return `${toneTag} ${raw}`.trim();
  }
}
