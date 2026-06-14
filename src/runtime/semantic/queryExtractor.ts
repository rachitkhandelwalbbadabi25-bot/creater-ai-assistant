export interface QueryExtractionResult {
  query: string;
  patternName: string;
}

const PLATFORM_SUFFIX_REGEX = /\s+(?:on\s+(?:google|youtube|bing|chrome)|from\s+(?:google|youtube)|online|offline)\s*$/i;
const LEADING_HELPER_REGEX = /^(?:can you tell me|please tell me|tell me|what is|who is|search|find|lookup|look up|show me|give me)\s+/i;
const TRAILING_HELPER_REGEX = /\s+(?:search it|google it|look it up|search)\s*$/i;
const PLATFORM_ONLY_REGEX = /^(?:google|youtube|bing|chrome|online|offline)$/i;
const HELPER_ONLY_REGEX = /^(?:tell me|what is|who is|search|find|lookup|look up|show me|give me|can you tell me|please tell me)$/i;

export function normalizePlatformSuffix(input: string): string {
  return input.replace(PLATFORM_SUFFIX_REGEX, "");
}

export function removeHelperWords(input: string): string {
  return input.replace(LEADING_HELPER_REGEX, "").replace(TRAILING_HELPER_REGEX, "");
}

export function normalizeSpacing(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function isValidSearchQuery(query: string): boolean {
  const normalized = normalizeSpacing(query);
  if (normalized.length <= 2) {
    return false;
  }
  if (HELPER_ONLY_REGEX.test(normalized) || PLATFORM_ONLY_REGEX.test(normalized)) {
    return false;
  }
  return true;
}

export function extractQuery(rawInput: string): QueryExtractionResult | null {
  const withoutPlatformSuffix = normalizePlatformSuffix(rawInput);
  const withoutHelpers = removeHelperWords(withoutPlatformSuffix);
  const normalized = normalizeSpacing(withoutHelpers);

  if (!isValidSearchQuery(normalized)) {
    return null;
  }

  return {
    query: normalized,
    patternName: "normalization-pipeline",
  };
}
