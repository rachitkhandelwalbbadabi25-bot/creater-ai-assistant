// ════════════════════════════════════════════════════════════════════════════════
// src/orchestration/universalPlan.ts — Universal Multi-Action Plan & Decomposer
// Provides structured, dependency-aware task decomposition, target continuity,
// execution method selection (NATIVE -> DOM/MCP -> DESKTOP CUA), and evidence-
// based status tracking across all supported platforms.
// ════════════════════════════════════════════════════════════════════════════════

import { createLogger } from "@utils/logger.js";

const log = createLogger("orchestration/universalPlan");

export type ActionStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "timed_out"
  | "partially_completed"
  | "verification_failed"
  | "cancelled"
  | "skipped";

export type ExecutionMethod = "native" | "dom" | "mcp" | "cua" | "llm";

export type ApprovalState =
  | "not_required"
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"
  | "modified";

export type UniversalIntentCategory =
  | "information_retrieval"
  | "web_search"
  | "navigation"
  | "application_control"
  | "file_operation"
  | "content_creation"
  | "editing"
  | "communication"
  | "social_media_action"
  | "media_playback"
  | "data_extraction"
  | "summarization"
  | "scheduling"
  | "memory_operation"
  | "multi_step_workflow"
  | "follow_up"
  | "cancellation"
  | "approval_response";

export interface VerificationEvidence {
  verified: boolean;
  status: "VERIFIED" | "NOT_VERIFIED" | "VERIFICATION_UNAVAILABLE";
  method: string;
  expected?: string;
  observed?: string;
  reason: string;
  timestamp: number;
}

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number;
  allowRetryAfterSideEffect: boolean;
}

export interface PlannedAction {
  id: string;
  type: string;
  category: UniversalIntentCategory;
  platform?: string;
  target?: string;
  targetFromStep?: string;
  params: Record<string, unknown>;
  dependsOn: string[];
  method: ExecutionMethod;
  fallbackMethods: ExecutionMethod[];
  expectedOutcome: string;
  requiresApproval: boolean;
  approvalState: ApprovalState;
  idempotent: boolean;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  status: ActionStatus;
  verificationRequirement: string;
  result?: unknown;
  evidence?: VerificationEvidence;
  error?: string;
}

export interface SharedTargetContext {
  targetType?: "youtube_video" | "youtube_channel" | "url" | "file" | "app" | "contact" | "product" | "generic";
  id?: string;
  url?: string;
  title?: string;
  channelName?: string;
  filePath?: string;
  app?: string;
  recipient?: string;
  verified?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UniversalExecutionPlan {
  planId: string;
  rawInput: string;
  normalizedInput: string;
  language: "english" | "hinglish" | "hindi";
  script: "roman" | "devanagari";
  intents: UniversalIntentCategory[];
  actions: PlannedAction[];
  sharedContext: SharedTargetContext;
  overallStatus: ActionStatus;
  createdAt: number;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface DecomposeContext {
  activeTarget?: SharedTargetContext;
  hasPendingApproval?: boolean;
}

const DEVANAGARI_REGEX = /[\u0900-\u097F]/;
const HINGLISH_HINT_REGEX =
  /\b(ab|abhi|aur|bhai|chala|chalao|dekh|dekho|kar|karo|ki|ka|ko|likh|likho|pe|par|pehla|pehli|sabse|yaar)\b/i;

const NEGATED_COMMENT_REGEX =
  /\b(?:don'?t|do\s+not|without|skip|mat|na)\s+(?:add\s+a?\s*)?(?:comment|commenting)\b/i;

const YOUTUBE_HINT_REGEX =
  /\b(youtube|yt|livestream|live\s+stream|livestreaming|live\s+streaming|broadcast|replay|stream)\b/i;

const LIVE_NOW_REGEX =
  /\b(currently\s+live|live\s+now|right\s+now\s+live|abhi\s+live|ongoing\s+live(?:stream)?|is\s+live)\b/i;

const REPLAY_REGEX =
  /\b(replay|past\s+livestream|completed\s+livestream|recorded\s+livestream|previous\s+livestream|last\s+stream)\b/i;

const LIVESTREAM_REGEX =
  /\b(livestream|live\s*stream|livestreaming|live\s*streaming|stream|broadcast|replay)\b/i;

export function detectLanguageAndScript(input: string): {
  language: "english" | "hinglish" | "hindi";
  script: "roman" | "devanagari";
} {
  if (DEVANAGARI_REGEX.test(input)) {
    return { language: "hindi", script: "devanagari" };
  }
  if (HINGLISH_HINT_REGEX.test(input)) {
    return { language: "hinglish", script: "roman" };
  }
  return { language: "english", script: "roman" };
}

/**
 * Splits a natural-language instruction into ordered clauses on "and", "then", "aur", "," or ";"
 * while preserving quoted strings and URLs intact.
 */
export function splitIntoActionClauses(input: string): string[] {
  const clauses: string[] = [];
  let current = "";
  let quoteChar: string | null = null;
  let i = 0;

  while (i < input.length) {
    const ch = input[i]!;
    const isWordApostrophe =
      ch === "'" && /\w/.test(input[i - 1] || "") && /\w/.test(input[i + 1] || "");
    if (!isWordApostrophe && (ch === '"' || ch === "'" || ch === "“" || ch === "”") && input[i - 1] !== "\\") {
      if (!quoteChar) {
        quoteChar = ch === "“" ? "”" : ch;
      } else if (ch === quoteChar || (quoteChar === "”" && ch === "”")) {
        quoteChar = null;
      }
      current += ch;
      i += 1;
      continue;
    }

    if (!quoteChar) {
      const rest = input.slice(i);
      const sepMatch = rest.match(/^(?:\s*;\s*|\s*,\s*(?:and\s+|then\s+)?|\s+(?:and\s+then|then|and|aur)\s+)/i);
      if (sepMatch) {
        const trimmed = current.trim();
        if (trimmed) clauses.push(trimmed);
        current = "";
        i += sepMatch[0].length;
        continue;
      }
    }

    current += ch;
    i += 1;
  }

  const tail = current.trim();
  if (tail) clauses.push(tail);
  return clauses.length > 0 ? clauses : [input.trim()];
}

/**
 * Normalizes a YouTube search query by removing action verbs, filler words,
 * platform specifiers, and secondary action instructions while preserving the
 * channel/subject and optional media type qualifier.
 */
export function normalizeYouTubeSearchQuery(
  rawClause: string,
  mediaSubtype: "currently_live" | "latest_livestream" | "livestream_replay" | "latest_video" | "channel_open" | "video"
): string {
  let q = rawClause
    .replace(/'s\b/gi, "")
    .replace(/["'“”]/g, " ")
    .replace(/[.!?]+/g, " ")
    .replace(/\b(?:ok|okay|now|abhi|ab|bhai|bro|yaar|hey|hello|please|kindly|can\s+you|could\s+you)\b/gi, " ")
    .replace(/\b(?:open|launch|play|watch|search|find|show\s+me|go\s+to|chala|chalao|dikha|click|subscribe|like|comment)\b/gi, " ")
    .replace(/\b(?:on|in|pe|par)\s+youtube\b/gi, " ")
    .replace(/\byoutube\b/gi, " ")
    .replace(/\b(?:the|this|that|his|her|their|a|an|my|its|some)\b/gi, " ")
    .replace(/\b(?:first|top|pehli|pehla|sabse\s+pehli|sabse\s+pehla|video|videos|result|results)\b/gi, " ")
    .replace(/\b(?:currently|right)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Strip possessive 's and orphan "of"
  q = q
    .replace(/'s\b/gi, "")
    .replace(/^(?:of|for|to|from)\s+/i, "")
    .replace(/\s+(?:of|for|to|from|ki|ka|ko)$/i, "")
    .replace(/\s+\b(?:of|ki|ka|ko)\b\s+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Strip raw stream/video modifiers so we can re-attach clean canonical qualifiers
  const subject = q
    .replace(/\b(newest|latest|recent|last|completed|past|recorded|live\s*streaming|livestreaming|live\s*stream|livestream|stream|broadcast|replay|live)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const cleanSubject = subject || q;
  if (!cleanSubject) return "";

  if (mediaSubtype === "currently_live") {
    return `${cleanSubject} live`.trim();
  }
  if (mediaSubtype === "latest_livestream" || mediaSubtype === "livestream_replay") {
    return `${cleanSubject} livestream`.trim();
  }
  return cleanSubject;
}

function extractCommentTextFromClause(clause: string): string | undefined {
  const quoted = clause.match(/["'“](.+?)["'”]/);
  if (quoted && quoted[1]?.trim()) {
    return quoted[1].trim();
  }

  let body = clause
    .replace(/^(?:please\s+)?(?:and\s+|then\s+|aur\s+)?(?:add\s+a?\s*)?(?:comment|write\s+a?\s*comment|post\s+a?\s*comment|leave\s+a?\s*comment|reply)\b/i, "")
    .trim();

  // Handle "comment on latest livestream ... that <comment>"
  const thatMatch = body.match(/^(?:on|in|under|to|pe|par)\s+.+?\bthat\s+(.+)$/i);
  if (thatMatch && thatMatch[1]?.trim()) {
    body = thatMatch[1].trim();
  } else {
    body = body
      .replace(/\s+(?:on|in|under|to|pe|par)\s+(?:their|thier|the|this|that|his|her|its|video|videos|livestream|stream|youtube|it|post)\b[\s\S]*$/i, "")
      .replace(/^(?:that|saying)\s+/i, "")
      .replace(/\s+(?:on\s+youtube|now|abhi|ab|please)$/i, "")
      .trim();
  }

  return body ? body.replace(/^["'“]|["'”]$/g, "").trim() : undefined;
}

function makeAction(partial: Omit<PlannedAction, "status" | "approvalState" | "retryPolicy" | "timeoutMs"> & {
  timeoutMs?: number;
  retryPolicy?: RetryPolicy;
  approvalState?: ApprovalState;
}): PlannedAction {
  return {
    ...partial,
    timeoutMs: partial.timeoutMs ?? 30000,
    approvalState: partial.approvalState ?? (partial.requiresApproval ? "pending" : "not_required"),
    retryPolicy: partial.retryPolicy ?? {
      maxAttempts: partial.idempotent ? 2 : 1,
      backoffMs: 500,
      allowRetryAfterSideEffect: false,
    },
    status: "pending",
  };
}

/**
 * Universal Multi-Action Task Decomposer.
 * Converts any natural-language user command into a dependency-aware,
 * verifiable UniversalExecutionPlan.
 */
export function decomposeTask(rawInput: string, context: DecomposeContext = {}): UniversalExecutionPlan {
  const trimmed = rawInput.trim();
  const normalizedInput = trimmed.replace(/\s+/g, " ");
  const { language, script } = detectLanguageAndScript(normalizedInput);
  const actions: PlannedAction[] = [];
  const intents = new Set<UniversalIntentCategory>();
  const sharedContext: SharedTargetContext = context.activeTarget ? { ...context.activeTarget } : {};

  // Check explicit cancellation or approval responses first
  if (/^(?:cancel|stop|abort|never\s*mind|nvm|mat\s+karo|band\s+karo)\b/i.test(normalizedInput)) {
    intents.add("cancellation");
    actions.push(
      makeAction({
        id: "action_1",
        type: "workflow.cancel",
        category: "cancellation",
        params: { rawInput: normalizedInput },
        dependsOn: [],
        method: "native",
        fallbackMethods: [],
        expectedOutcome: "Pending workflow or approval is cancelled cleanly.",
        requiresApproval: false,
        idempotent: true,
        verificationRequirement: "pending_state_cleared",
      })
    );
    return finalizePlan(trimmed, normalizedInput, language, script, intents, actions, sharedContext);
  }

  // Check negated comment instruction (e.g. "Play the video but don't comment")
  const hasNegatedComment = NEGATED_COMMENT_REGEX.test(normalizedInput);
  const cleanedForClauses = normalizedInput
    .replace(/\b(?:but|and)\s+(?:don'?t|do\s+not|never)\s+(?:add\s+a?\s*)?(?:comment|commenting)\b[\s\S]*/i, "")
    .replace(/\bwithout\s+commenting\b[\s\S]*/i, "")
    .trim();

  const clauses = splitIntoActionClauses(cleanedForClauses);
  const isYouTubeDomain =
    YOUTUBE_HINT_REGEX.test(normalizedInput) ||
    (/\b(video|videos)\b/i.test(normalizedInput) && /\b(play|watch|subscribe|comment|chala|chalao)\b/i.test(normalizedInput)) ||
    sharedContext.targetType === "youtube_video";

  let lastMediaActionId: string | undefined;
  let lastBrowserActionId: string | undefined;
  let lastResearchActionId: string | undefined;
  let lastSummaryActionId: string | undefined;
  let lastDirActionId: string | undefined;
  let lastFileActionId: string | undefined;
  let lastProductActionId: string | undefined;

  for (const clause of clauses) {
    const lower = clause.toLowerCase();
    const idx = actions.length + 1;
    const actionId = `action_${idx}`;

    // 1. YouTube / Video Comment Clause
    if (
      !hasNegatedComment &&
      /\b(?:comment|write\s+a?\s*comment|post\s+a?\s*comment|leave\s+a?\s*comment)\b/i.test(lower)
    ) {
      const commentText = extractCommentTextFromClause(clause);
      const isCommentWithImplicitVideoTarget =
        !lastMediaActionId &&
        /\b(?:latest|newest|recent|livestream|live\s*stream|livestreaming|stream)\b/i.test(lower) &&
        !/\bthis\s+video\b/i.test(lower);

      if (isCommentWithImplicitVideoTarget) {
        // Decompose into resolve/open target video FIRST, then comment on that exact video
        const mediaSubtype: "currently_live" | "latest_livestream" | "livestream_replay" | "latest_video" =
          LIVE_NOW_REGEX.test(lower)
            ? "currently_live"
            : REPLAY_REGEX.test(lower)
              ? "livestream_replay"
              : LIVESTREAM_REGEX.test(lower)
                ? "latest_livestream"
                : "latest_video";
        const query = normalizeYouTubeSearchQuery(
          clause.replace(/\bthat\s+[\s\S]+$/i, ""),
          mediaSubtype
        );
        const selectId = `action_${actions.length + 1}`;
        intents.add("media_playback");
        actions.push(
          makeAction({
            id: selectId,
            type: "youtube.select_and_play",
            category: "media_playback",
            platform: "youtube",
            target: query,
            params: { query, mediaSubtype, action: "play", requireChannelVerification: true },
            dependsOn: [],
            method: "dom",
            fallbackMethods: ["native", "cua"],
            expectedOutcome: `Correct ${mediaSubtype} video for "${query}" is opened and playing.`,
            requiresApproval: false,
            idempotent: true,
            verificationRequirement: "youtube_playback_verified",
          })
        );
        lastMediaActionId = selectId;
      }

      const commentActionId = `action_${actions.length + 1}`;
      intents.add("social_media_action");
      actions.push(
        makeAction({
          id: commentActionId,
          type: "youtube.comment",
          category: "social_media_action",
          platform: "youtube",
          target: sharedContext.url || sharedContext.title,
          targetFromStep: lastMediaActionId,
          params: {
            commentText: commentText || "",
            missingCommentText: !commentText,
          },
          dependsOn: lastMediaActionId ? [lastMediaActionId] : [],
          method: "dom",
          fallbackMethods: ["cua"],
          expectedOutcome: `Comment "${commentText || ""}" is published on the verified target video.`,
          requiresApproval: true,
          idempotent: false,
          verificationRequirement: "youtube_comment_published",
        })
      );
      continue;
    }

    // 2. YouTube Subscribe / Like Clause
    if (isYouTubeDomain && /\b(subscribe|like)\b/i.test(lower)) {
      const subAction = /\bsubscribe\b/i.test(lower) ? "youtube.subscribe" : "youtube.like";
      intents.add("social_media_action");
      actions.push(
        makeAction({
          id: actionId,
          type: subAction,
          category: "social_media_action",
          platform: "youtube",
          targetFromStep: lastMediaActionId,
          params: { action: subAction === "youtube.subscribe" ? "subscribe" : "like" },
          dependsOn: lastMediaActionId ? [lastMediaActionId] : [],
          method: "dom",
          fallbackMethods: ["cua"],
          expectedOutcome: `Action ${subAction} completed on target YouTube channel/video.`,
          requiresApproval: subAction === "youtube.subscribe",
          idempotent: true,
          verificationRequirement: "dom_state_changed",
        })
      );
      continue;
    }

    // 3. YouTube Playback / Channel / Livestream Clause
    if (
      isYouTubeDomain &&
      (/\b(play|watch|open|search|find|chala|chalao|dikha)\b/i.test(lower) || LIVESTREAM_REGEX.test(lower))
    ) {
      const isSearchOnly = /^(?:search|find|show\s+me)\b/i.test(lower) && !/\bplay\b/i.test(lower);
      const isOpenChannelOnly =
        /^open\s+/i.test(lower) && !LIVESTREAM_REGEX.test(lower) && !/\b(video|latest|newest|play)\b/i.test(lower);

      const mediaSubtype:
        | "currently_live"
        | "latest_livestream"
        | "livestream_replay"
        | "latest_video"
        | "channel_open"
        | "video" = LIVE_NOW_REGEX.test(lower)
        ? "currently_live"
        : REPLAY_REGEX.test(lower)
          ? "livestream_replay"
          : LIVESTREAM_REGEX.test(lower)
            ? "latest_livestream"
            : isOpenChannelOnly
              ? "channel_open"
              : /\b(latest|newest|recent)\b/i.test(lower)
                ? "latest_video"
                : "video";

      const query = normalizeYouTubeSearchQuery(clause, mediaSubtype);
      intents.add(isSearchOnly || isOpenChannelOnly ? "navigation" : "media_playback");
      actions.push(
        makeAction({
          id: actionId,
          type: isSearchOnly ? "youtube.search" : isOpenChannelOnly ? "youtube.open_channel" : "youtube.select_and_play",
          category: isSearchOnly || isOpenChannelOnly ? "navigation" : "media_playback",
          platform: "youtube",
          target: query,
          params: {
            query,
            mediaSubtype,
            action: isSearchOnly ? "search" : "play",
            requireChannelVerification: true,
          },
          dependsOn: [],
          method: isSearchOnly || isOpenChannelOnly ? "native" : "dom",
          fallbackMethods: ["native", "cua"],
          expectedOutcome: isSearchOnly
            ? `YouTube search results opened for "${query}".`
            : `Verified ${mediaSubtype} video for "${query}" is playing.`,
          requiresApproval: false,
          idempotent: true,
          verificationRequirement: isSearchOnly ? "url_match" : "youtube_playback_verified",
        })
      );
      lastMediaActionId = actionId;
      continue;
    }

    // 4. Open Browser / Navigate Clause
    if (/^(?:open|launch|start)\s+(?:my\s+|the\s+)?(?:web\s+)?browser\b/i.test(lower)) {
      intents.add("navigation");
      actions.push(
        makeAction({
          id: actionId,
          type: "browser.open",
          category: "navigation",
          platform: "browser",
          target: "browser",
          params: {},
          dependsOn: [],
          method: "dom",
          fallbackMethods: ["native", "cua"],
          expectedOutcome: "Browser session is open and ready.",
          requiresApproval: false,
          idempotent: true,
          verificationRequirement: "browser_session_ready",
        })
      );
      lastBrowserActionId = actionId;
      continue;
    }

    // 5. Web Search / Find News / Find Product Clause
    if (/^(?:search(?:\s+for)?|find|look\s*up|research)\b/i.test(lower)) {
      const searchQuery = clause
        .replace(/^(?:please\s+)?(?:search(?:\s+for)?|find|look\s*up|research)\s+/i, "")
        .trim();
      intents.add("web_search");
      actions.push(
        makeAction({
          id: actionId,
          type: "browser.search",
          category: "web_search",
          platform: "web",
          target: searchQuery,
          params: { query: searchQuery },
          dependsOn: lastBrowserActionId ? [lastBrowserActionId] : [],
          method: "dom",
          fallbackMethods: ["mcp", "cua"],
          expectedOutcome: `Relevant results found for "${searchQuery}".`,
          requiresApproval: false,
          idempotent: true,
          verificationRequirement: "search_results_non_empty",
        })
      );
      lastResearchActionId = actionId;
      if (/\b(product|item|laptop|phone|keyboard|shoe|book)\b/i.test(lower)) {
        lastProductActionId = actionId;
      }
      continue;
    }

    // 5b. Create Folder / Directory Clause
    if (/\b(?:create|make|new)\s+(?:a\s+)?(?:folder|directory|dir)\b/i.test(lower)) {
      const dirMatch = clause.match(/\b(?:folder|directory|dir)\s+(?:named\s+|called\s+)?["'“]?([a-zA-Z0-9_.:/\\-]+)["'”]?/i);
      const dirName = dirMatch?.[1]?.trim() || `creater_dir_${Date.now()}`;
      intents.add("file_operation");
      actions.push(
        makeAction({
          id: actionId,
          type: "fs.create_directory",
          category: "file_operation",
          target: dirName,
          params: { path: dirName, instruction: clause },
          dependsOn: [],
          method: "native",
          fallbackMethods: ["mcp"],
          expectedOutcome: `Directory "${dirName}" created.`,
          requiresApproval: false,
          idempotent: true,
          verificationRequirement: "directory_exists",
        })
      );
      lastDirActionId = actionId;
      continue;
    }

    // 6. Save / Create Document / File Clause (check BEFORE summarize so "save the summary in a document" matches file_operation)
    if (/\b(save|write|create)\b[\s\S]*\b(document|doc|file|note|report)\b/i.test(lower)) {
      const fileMatch = clause.match(/\bfile\s+["'“]?([a-zA-Z0-9_.\-/\\]+)["'”]?/i);
      const fileName = fileMatch?.[1]?.trim();
      intents.add("file_operation");
      const deps = [lastSummaryActionId || lastResearchActionId, lastDirActionId].filter(Boolean) as string[];
      actions.push(
        makeAction({
          id: actionId,
          type: "fs.write_document",
          category: "file_operation",
          target: fileName,
          targetFromStep: lastSummaryActionId || lastDirActionId,
          params: { instruction: clause, ...(fileName ? { fileName } : {}) },
          dependsOn: deps,
          method: "native",
          fallbackMethods: ["mcp", "cua"],
          expectedOutcome: "Document created and saved to disk.",
          requiresApproval: false,
          idempotent: true,
          verificationRequirement: "file_exists",
        })
      );
      lastFileActionId = actionId;
      continue;
    }

    // 6b. Verify File Contents Clause
    if (/\b(?:verify|check|inspect)\b[\s\S]*\b(?:contents?|file|it)\b/i.test(lower) && lastFileActionId) {
      intents.add("file_operation");
      actions.push(
        makeAction({
          id: actionId,
          type: "fs.verify_file",
          category: "file_operation",
          targetFromStep: lastFileActionId,
          params: { instruction: clause },
          dependsOn: [lastFileActionId],
          method: "native",
          fallbackMethods: ["mcp"],
          expectedOutcome: "File existence and contents verified.",
          requiresApproval: false,
          idempotent: true,
          verificationRequirement: "file_exists",
        })
      );
      continue;
    }

    // 7. Summarize / Extract Clause
    if (/\b(summarize|summary|extract|compare\s+(?:its\s+)?price|compare)\b/i.test(lower)) {
      const isPriceCompare = /\bcompare\b/i.test(lower);
      intents.add(isPriceCompare ? "data_extraction" : "summarization");
      const deps = [lastResearchActionId || lastBrowserActionId].filter(Boolean) as string[];
      actions.push(
        makeAction({
          id: actionId,
          type: isPriceCompare ? "web.compare_prices" : "content.summarize",
          category: isPriceCompare ? "data_extraction" : "summarization",
          targetFromStep: lastResearchActionId || lastProductActionId,
          params: { instruction: clause },
          dependsOn: deps,
          method: "llm",
          fallbackMethods: ["dom"],
          expectedOutcome: isPriceCompare ? "Prices compared across candidates." : "Extracted content summarized accurately.",
          requiresApproval: false,
          idempotent: true,
          verificationRequirement: "non_empty_output",
        })
      );
      lastSummaryActionId = actionId;
      continue;
    }

    // 8. Add to cart / Purchase / Checkout Clause
    if (/\b(add\s+(?:it\s+)?to\s+(?:my\s+)?cart|checkout|buy|purchase)\b/i.test(lower)) {
      const isPurchase = /\b(checkout|buy|purchase)\b/i.test(lower);
      intents.add("social_media_action");
      actions.push(
        makeAction({
          id: actionId,
          type: isPurchase ? "commerce.purchase" : "commerce.add_to_cart",
          category: "social_media_action",
          platform: "web",
          targetFromStep: lastProductActionId || lastResearchActionId,
          params: { instruction: clause },
          dependsOn: [lastSummaryActionId || lastProductActionId || lastResearchActionId].filter(Boolean) as string[],
          method: "dom",
          fallbackMethods: ["cua"],
          expectedOutcome: isPurchase ? "Purchase completed after approval." : "Product added to cart.",
          requiresApproval: isPurchase,
          idempotent: !isPurchase,
          verificationRequirement: "cart_or_order_updated",
        })
      );
      continue;
    }

    // 9. Open Saved Document / Follow-up Open Clause
    if (/^(?:open|show)\s+(?:that\s+document|the\s+saved\s+document|that\s+file|it|the\s+document)\b/i.test(lower)) {
      intents.add("file_operation");
      const deps = lastFileActionId ? [lastFileActionId] : [];
      actions.push(
        makeAction({
          id: actionId,
          type: "system.open_path",
          category: "file_operation",
          target: sharedContext.filePath,
          targetFromStep: lastFileActionId,
          params: { instruction: clause },
          dependsOn: deps,
          method: "native",
          fallbackMethods: ["cua"],
          expectedOutcome: "Saved document is opened and visible.",
          requiresApproval: false,
          idempotent: true,
          verificationRequirement: "file_opened",
        })
      );
      continue;
    }

    // 10. Generic Fallback Action (never discard!)
    intents.add("multi_step_workflow");
    actions.push(
      makeAction({
        id: actionId,
        type: "task.execute_step",
        category: "multi_step_workflow",
        params: { instruction: clause },
        dependsOn: actions.length > 0 ? [actions[actions.length - 1]!.id] : [],
        method: "dom",
        fallbackMethods: ["native", "mcp", "cua", "llm"],
        expectedOutcome: `Completed step: ${clause}`,
        requiresApproval: /\b(send|post|delete|remove|submit|pay|purchase)\b/i.test(lower),
        idempotent: false,
        verificationRequirement: "tool_result_verified",
      })
    );
  }

  if (actions.length > 1) {
    intents.add("multi_step_workflow");
  }

  return finalizePlan(trimmed, normalizedInput, language, script, intents, actions, sharedContext);
}

function finalizePlan(
  rawInput: string,
  normalizedInput: string,
  language: "english" | "hinglish" | "hindi",
  script: "roman" | "devanagari",
  intents: Set<UniversalIntentCategory>,
  actions: PlannedAction[],
  sharedContext: SharedTargetContext
): UniversalExecutionPlan {
  const plan: UniversalExecutionPlan = {
    planId: `plan_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    rawInput,
    normalizedInput,
    language,
    script,
    intents: Array.from(intents),
    actions,
    sharedContext,
    overallStatus: "pending",
    createdAt: Date.now(),
  };

  log.info("[UNIVERSAL_PLAN_DECOMPOSED]", {
    planId: plan.planId,
    intents: plan.intents,
    actionCount: plan.actions.length,
    actionTypes: plan.actions.map((a) => a.type),
  });

  return plan;
}

/**
 * Validates plan structure, dependencies, target continuity, and approval flags
 * before any execution begins.
 */
export function validateExecutionPlan(plan: UniversalExecutionPlan): PlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  if (!plan.actions || plan.actions.length === 0) {
    errors.push("Execution plan contains zero actions.");
    return { valid: false, errors, warnings };
  }

  for (const action of plan.actions) {
    if (seenIds.has(action.id)) {
      errors.push(`Duplicate action id detected: ${action.id}`);
    }
    seenIds.add(action.id);

    for (const dep of action.dependsOn) {
      if (!seenIds.has(dep) && !plan.actions.some((a) => a.id === dep)) {
        errors.push(`Action ${action.id} depends on unknown action ${dep}`);
      }
      if (dep === action.id) {
        errors.push(`Action ${action.id} cannot depend on itself`);
      }
    }

    if (action.targetFromStep && !plan.actions.some((a) => a.id === action.targetFromStep)) {
      errors.push(`Action ${action.id} references missing targetFromStep ${action.targetFromStep}`);
    }

    if (action.type === "youtube.comment" && action.params.missingCommentText === true) {
      warnings.push(`Action ${action.id} (youtube.comment) is missing explicit comment text.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Computes overall plan status from individual action statuses.
 * Never reports "completed" when any action failed, awaits approval, or failed verification.
 */
export function computePlanOverallStatus(actions: PlannedAction[]): ActionStatus {
  if (actions.length === 0) return "failed";
  const statuses = actions.map((a) => a.status);

  if (statuses.every((s) => s === "completed")) return "completed";
  if (statuses.some((s) => s === "awaiting_approval")) {
    return statuses.some((s) => s === "completed") ? "partially_completed" : "awaiting_approval";
  }
  if (statuses.some((s) => s === "verification_failed")) {
    return statuses.some((s) => s === "completed") ? "partially_completed" : "verification_failed";
  }
  if (statuses.some((s) => s === "failed" || s === "timed_out")) {
    return statuses.some((s) => s === "completed") ? "partially_completed" : statuses.every((s) => s === "timed_out") ? "timed_out" : "failed";
  }
  if (statuses.some((s) => s === "cancelled")) {
    return statuses.some((s) => s === "completed") ? "partially_completed" : "cancelled";
  }
  if (statuses.some((s) => s === "running")) return "running";
  return "pending";
}

/**
 * Generates an accurate, evidence-backed summary directly from actual action states.
 * Never claims unverified or failed actions succeeded.
 */
export function formatPlanExecutionSummary(plan: UniversalExecutionPlan): string {
  const overall = computePlanOverallStatus(plan.actions);
  const completed = plan.actions.filter((a) => a.status === "completed");
  const awaiting = plan.actions.filter((a) => a.status === "awaiting_approval");
  const failed = plan.actions.filter(
    (a) => a.status === "failed" || a.status === "timed_out" || a.status === "verification_failed"
  );

  const lines: string[] = [];
  for (const a of plan.actions) {
    if (a.status === "completed") {
      const verifiedTag = a.evidence?.verified ? " (verified)" : " (unverified)";
      lines.push(`✅ ${a.type}${verifiedTag}: ${a.evidence?.observed || a.expectedOutcome}`);
    } else if (a.status === "awaiting_approval") {
      lines.push(`⏸️ ${a.type}: Awaiting user approval before executing external side effect.`);
    } else if (a.status === "verification_failed") {
      lines.push(`⚠️ ${a.type}: Verification failed — ${a.evidence?.reason || a.error || "outcome not confirmed"}`);
    } else if (a.status === "timed_out") {
      lines.push(`⏱️ ${a.type}: Timed out — ${a.error || "action exceeded timeout"}`);
    } else if (a.status === "failed") {
      lines.push(`❌ ${a.type}: Failed — ${a.error || "unknown error"}`);
    } else if (a.status === "cancelled") {
      lines.push(`🛑 ${a.type}: Cancelled.`);
    } else if (a.status === "skipped") {
      lines.push(`⏭️ ${a.type}: Skipped due to upstream failure.`);
    }
  }

  const header =
    overall === "completed"
      ? `Completed all ${completed.length} action(s) with verification.`
      : overall === "awaiting_approval"
        ? `Action prepared and awaiting your approval.`
        : overall === "partially_completed"
          ? `Partially completed (${completed.length}/${plan.actions.length} succeeded; ${awaiting.length} awaiting approval, ${failed.length} failed).`
          : overall === "verification_failed"
            ? `Action attempted, but verification failed.`
            : `Execution failed (${failed.length} action(s) failed).`;

  return `${header}\n${lines.join("\n")}`;
}
