import { createLogger } from "@utils/logger.js";

const log = createLogger("graph/commandRouter");

import { FactCategory } from "../memory/longTerm.js";
import { parseMemoryStoreInput, isMemoryListInput, parseMemoryQueryInput } from "../memory/memoryParser.js";
import { normalizeYouTubeSearchQuery } from "../orchestration/universalPlan.js";
import type { YouTubeMediaSubtype } from "../tools/laptop/youtubeIntelligence.js";

export type FastCommand =
  | { kind: "open_app"; raw: string; app: string }
  | { kind: "open_url"; raw: string; url: string }
  | { kind: "open_path"; raw: string; path: string }
  | { kind: "open_downloads"; raw: string; path: string }
  | { kind: "close_app"; raw: string; app: string }
  | { kind: "browser_home"; raw: string }
  | {
      kind: "youtube";
      raw: string;
      action: "play" | "search" | "comment";
      query?: string;
      selection?: "first";
      comment?: string;
      mediaSubtype?: YouTubeMediaSubtype;
      subscribe?: boolean;
      commentOnly?: boolean;
    }
  | { kind: "reminder"; raw: string; action: "create" | "list" | "cancel" | "query"; title?: string; timeInput?: string; query?: string; queryType?: "latest" | "all" }
  | { kind: "volume"; raw: string; direction: "up" | "down" | "mute" | "unmute" | "set"; value?: number }
  | { kind: "screenshot"; raw: string }
  | { kind: "memory_store"; raw: string; category: FactCategory; key: string; value: string }
  | { kind: "memory_list"; raw: string }
  | { kind: "memory_query"; raw: string; query: string }
  | { kind: "active_window"; raw: string }
  | { kind: "cua_click"; raw: string; x: number; y: number }
  | { kind: "cua_type"; raw: string; text: string; targetApp?: string }
  | { kind: "mcp_list"; raw: string }
  | { kind: "social_message"; raw: string; platform: string; recipient: string; message: string }
  | { kind: "browser_act"; raw: string; goal: string; targetUrl?: string }
  | {
    kind: "app_compose";
    raw: string;
    app: string;
    mode: "generate" | "literal" | "from_history";
    prompt?: string;
    text?: string;
  };

export function normalizeCommandInput(input: string): string {
  return input
    .toLowerCase()
    .replace(/\b(now|ab|abhi|just|please|kindly|can you|could you|bro|yaar)\b/g, "")
    .replace(/\b(open|launch|start|run|please open)\b/g, "open")
    .replace(/[!?.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripOpenVerb(text: string): string {
  return text.replace(/^open\s+/i, "").trim();
}

const APP_ALIASES = [
  { match: /^(notepad|notes?)$/i, app: "notepad" },
  { match: /^(calculator|calc)$/i, app: "calculator" },
  { match: /^(chrome|google chrome)$/i, app: "chrome" },
  { match: /^(edge|microsoft edge)$/i, app: "edge" },
  { match: /^(firefox)$/i, app: "firefox" },
  { match: /^(vscode|vs code|visual studio code|code)$/i, app: "vscode" },
  { match: /^(paint|mspaint)$/i, app: "paint" },
  { match: /^(explorer|file explorer|files?)$/i, app: "explorer" },
];

const DETERMINISTIC_COMMAND_MAP: Record<string, FastCommand> = {
  "open notepad": { kind: "open_app", raw: "open notepad", app: "notepad" },
  "open chrome": { kind: "open_app", raw: "open chrome", app: "chrome" },
  "open calculator": { kind: "open_app", raw: "open calculator", app: "calculator" },
  "open calc": { kind: "open_app", raw: "open calc", app: "calculator" },
  "open youtube": { kind: "youtube", raw: "open youtube", action: "play" },
  "open downloads": { kind: "open_downloads", raw: "open downloads", path: "%USERPROFILE%\\Downloads" },
  "volume up": { kind: "volume", raw: "volume up", direction: "up" },
  "volume down": { kind: "volume", raw: "volume down", direction: "down" },
  mute: { kind: "volume", raw: "mute", direction: "mute" },
  unmute: { kind: "volume", raw: "unmute", direction: "unmute" },
  screenshot: { kind: "screenshot", raw: "screenshot" },
  "take screenshot": { kind: "screenshot", raw: "take screenshot" },
  "take a screenshot": { kind: "screenshot", raw: "take a screenshot" },
  "capture screen": { kind: "screenshot", raw: "capture screen" },
  ss: { kind: "screenshot", raw: "ss" },
};

export function parseYouTubeCommand(
  input: string
): {
  action: "play" | "search" | "comment";
  query?: string;
  selection?: "first";
  comment?: string;
  mediaSubtype?: YouTubeMediaSubtype;
  subscribe?: boolean;
  commentOnly?: boolean;
} | null {
  const raw = input.trim();
  if (!raw) return null;

  // Ignore direct URLs
  if (/^(https?:\/\/|www\.)[^\s]+/i.test(raw)) return null;

  const isExplicitYouTube = /\byoutube\b/i.test(raw);
  const isVideoKeyword = /\b(video|videos|result|results)\b/i.test(raw);
  const isLivestreamKeyword = /\b(livestream|live\s*stream|livestreaming|live\s*streaming|stream|broadcast|replay)\b/i.test(raw);
  const isPlayAction = /\b(play|chala|chalao)\b/i.test(raw);
  const isSearchAction = /\b(search|find|show\s+me)\b/i.test(raw);
  const isCommentAction = /\b(?:comment|write\s+a?\s*comment|post\s+a?\s*comment|leave\s+a?\s*comment)\b/i.test(raw);
  const isSelectionPhrase = /\b(first|top|pehli|pehla|sabse\s+pehli|sabse\s+pehla)\b/i.test(raw);

  if (
    !isExplicitYouTube &&
    !isLivestreamKeyword &&
    !(isVideoKeyword && (isPlayAction || isSearchAction || isCommentAction || /\b(ki|ka)\b/i.test(raw))) &&
    !isSelectionPhrase
  ) {
    return null;
  }

  // Detect negated comment instruction ("Play the video but don't comment")
  const hasNegatedComment = /\b(?:don'?t|do\s+not|without|skip|mat|na)\s+(?:add\s+a?\s*)?(?:comment|commenting)\b/i.test(raw);
  const hasSubscribe = /\b(?:and|then|aur)\s+(?:please\s+)?subscribe\b/i.test(raw);

  // Determine media subtype
  const mediaSubtype: YouTubeMediaSubtype = /\b(currently\s+live|live\s+now|right\s+now\s+live|abhi\s+live|ongoing\s+live)\b/i.test(raw)
    ? "currently_live"
    : /\b(replay|completed\s+livestream|past\s+livestream|recorded\s+livestream)\b/i.test(raw)
      ? "livestream_replay"
      : isLivestreamKeyword || /\bstream\b/i.test(raw)
        ? "latest_livestream"
        : /\b(latest|newest|recent)\b/i.test(raw)
          ? "latest_video"
          : "video";

  // Check standalone comment command (e.g. "now comment on latest livestreaming of carryminati now on youtube that carry bhai big fan"
  // or "Comment Carry bhai big fan on this video")
  const isStandaloneComment =
    !hasNegatedComment &&
    isCommentAction &&
    !/\b(play|watch|search|find|chala|chalao)\b/i.test(
      raw.replace(/\bcomment\b[\s\S]*$/i, "")
    );

  // Determine action: COMMENT vs SEARCH vs PLAY
  let action: "play" | "search" | "comment" = "play";
  if (isStandaloneComment) {
    action = "comment";
  } else if (
    /^(search|find|show\s+me)\b/i.test(raw) ||
    /\byoutube\s+search\b/i.test(raw) ||
    /\bsearch\s+.*on\s+youtube\b/i.test(raw)
  ) {
    action = "search";
  }

  // Extract comment text (handles both "and comment ..." and standalone "comment ... that ...")
  let comment: string | undefined;
  if (!hasNegatedComment) {
    const commentClauseMatch = raw.match(
      /(?:^|\s+(?:and|then|aur)\s+)(?:(?:ok|okay|now|abhi|ab|please)\s+)*(?:comment|write\s+a?\s*comment|post\s+a?\s*comment|leave\s+a?\s*comment|reply)\b\s*([\s\S]+)$/i
    );
    if (commentClauseMatch && commentClauseMatch[1]) {
      const clauseBody = commentClauseMatch[1].trim();
      const quotedComment = clauseBody.match(/["'“](.+?)["'”]/);
      const thatMatch = !quotedComment ? clauseBody.match(/\bthat\s+(.+)$/i) : null;
      if (quotedComment && quotedComment[1].trim()) {
        comment = quotedComment[1].trim();
      } else if (thatMatch && thatMatch[1].trim()) {
        comment = thatMatch[1].replace(/\s+(?:on\s+youtube|now|abhi|ab|please)$/i, "").trim();
      } else {
        const cleanedComment = clauseBody
          .replace(
            /\s+(?:on|in|under|to|pe|par)\s+(?:their|thier|the|this|that|his|her|its|video|videos|livestream|stream|youtube|it|post)\b[\s\S]*$/i,
            ""
          )
          .replace(/\s+(?:comment\s*)?(?:kar|karo|kar\s*do|de|do|now|abhi|ab|bhai|bro|yaar|please)+$/i, "")
          .replace(/^["'“]|["'”.,!?]+$/g, "")
          .trim();
        if (cleanedComment) {
          comment = cleanedComment;
        }
      }
    }
  }

  // Preserve quoted queries only when the quote is the direct object of play/search/find
  // (e.g. play "Hustle 5 first video"), NOT when quotes belong to a trailing "and comment 'hello'" clause
  const directQuotedMatch = raw.match(
    /^(?:(?:ok|okay|now|abhi|ab|bhai|bro|yaar|hey|hello|please|kindly|can\s+you|could\s+you)\s+)*(?:open\s+youtube\s+(?:and|to)\s+)?(?:play|search|find|show\s+me)\s+["'“](.+?)["'”](?:\s+on\s+youtube)?$/i
  );
  if (directQuotedMatch && directQuotedMatch[1].trim()) {
    const query = directQuotedMatch[1].trim();
    return {
      action,
      query,
      ...(action === "play" ? { selection: "first" as const } : {}),
      ...(comment ? { comment } : {}),
    };
  }

  if (isStandaloneComment) {
    // If referencing "this video", keep query undefined so active target is used; otherwise extract target query
    const isThisVideoRef = /\bthis\s+video\b/i.test(raw);
    let targetQuery: string | undefined;
    if (!isThisVideoRef) {
      const targetPart = raw
        .replace(/^(?:(?:ok|okay|now|abhi|ab|please)\s+)*(?:comment|write\s+a?\s*comment|post\s+a?\s*comment|leave\s+a?\s*comment)\s+(?:on|in|under|to)\s+/i, "")
        .replace(/\bthat\s+[\s\S]+$/i, "")
        .trim();
      const cleanedTarget = normalizeYouTubeSearchQuery(targetPart, mediaSubtype);
      if (cleanedTarget && !/^(?:this|that|the|video)$/i.test(cleanedTarget)) {
        targetQuery = cleanedTarget;
      }
    }
    return {
      action: "comment",
      ...(targetQuery ? { query: targetQuery } : {}),
      ...(comment ? { comment } : {}),
      mediaSubtype,
      commentOnly: true,
    };
  }

  let query = raw;

  // Strip negated comment suffix (e.g. "but don't comment")
  query = query
    .replace(/\s+(?:but|and)\s+(?:don'?t|do\s+not|never)\s+(?:add\s+a?\s*)?(?:comment|commenting)\b[\s\S]*$/i, "")
    .replace(/\s+without\s+commenting\b[\s\S]*$/i, "");

  // Strip trailing secondary clauses such as "and comment 'hello' on their video now", "and like the video", "and subscribe"
  query = query.replace(
    /\s+(?:and|then|aur)\s+(?:please\s+)?(?:comment|write\s+a?\s*comment|post\s+a?\s*comment|leave\s+a?\s*comment|reply|write|type|say|post|like|subscribe|share)\b[\s\S]*$/i,
    ""
  );

  // 0. Remove conversational / polite filler prefixes before parsing YouTube query
  // e.g. "ok now can you", "ok now", "can you", "please", "bhai", "yaar", "ab", "abhi"
  query = query.replace(/^(?:(?:ok|okay|now|abhi|ab|bhai|bro|yaar|hey|hello|please|kindly|can\s+you|could\s+you)\s+)+/i, "");

  // 1. Remove leading YouTube prefix and conjunctions
  query = query.replace(/^(?:youtube\s+(?:pe|par|search\s+for|search)?|open\s+youtube(?:\s+(?:and|to)\s+(?:play|search))?)\s*/i, "");

  // 2. Remove leading action verbs
  query = query.replace(/^(?:and\s+)?(?:search|find|show\s+me|play|open|run)\s+/i, "");

  // 3. Remove selection phrases describing WHICH result to pick
  // e.g. "the first video which you see", "first video you see", "the first video that you see", "first video", "first result", "top video", "pehli video", "sabse pehli video"
  query = query.replace(/\b(?:the\s+)?(?:first|top|pehli|pehla|sabse\s+pehli|sabse\s+pehla)\s*(?:video|videos|result|results|one)?(?:\s+(?:which|that)?\s*you\s+see)?\b/gi, " ");

  // 4. Remove YouTube transport/location phrases
  // e.g. "on youtube of", "on youtube pe", "on youtube", "in youtube", "pe youtube", "par youtube"
  query = query.replace(/\b(?:on|in|pe|par)\s+youtube(?:\s+(?:of|pe|par))?\b/gi, " ");
  query = query.replace(/^youtube\s+/i, "");

  // 5. Remove trailing Hinglish / English action suffixes, connectors, trailing filler words and leftover video terms
  query = query
    .replace(/\s+(?:ki|ka|ko)?\s*(?:video|videos|result|results)?\s*(?:chala|chalao|play\s*kar|play\s*karo|play|dikha)?$/i, "")
    .replace(/\s+(?:ki|ka|ko)$/i, "")
    .replace(/\s+(?:chala|chalao|play\s*kar|play\s*karo)$/i, "")
    .replace(/\s+(?:video|videos)$/i, "")
    .replace(/\s+(?:now|abhi|ab|bhai|bro|yaar|please)$/i, "")
    .replace(/^\s*of\s+/i, "")
    .replace(/\s+of\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  // Clean any residual leading verb or connectors
  query = query.replace(/^(?:and\s+)?(?:play|search|find|show\s+me|of)\s+/i, "").trim();

  // For livestream / replay intents, normalize the search query cleanly
  if (query && (mediaSubtype === "currently_live" || mediaSubtype === "latest_livestream" || mediaSubtype === "livestream_replay")) {
    const normalizedYt = normalizeYouTubeSearchQuery(query, mediaSubtype);
    if (normalizedYt) {
      query = normalizedYt;
    }
  }

  const exposeSubtype = mediaSubtype !== "video" && mediaSubtype !== "latest_video";

  if (!query || query.toLowerCase() === "youtube") {
    return {
      action,
      query: undefined,
      ...(action === "play" ? { selection: "first" as const } : {}),
      ...(comment ? { comment } : {}),
      ...(exposeSubtype ? { mediaSubtype } : {}),
      ...(hasSubscribe ? { subscribe: true } : {}),
    };
  }

  return {
    action,
    query,
    ...(action === "play" ? { selection: "first" as const } : {}),
    ...(comment ? { comment } : {}),
    ...(exposeSubtype ? { mediaSubtype } : {}),
    ...(hasSubscribe ? { subscribe: true } : {}),
  };
}

const GENERIC_REMINDER_COMMAND_TEXTS = new Set([
  "set a reminder",
  "set reminder",
  "remind me",
  "can you set a reminder",
  "can you remind me",
  "you have to set a reminder",
  "please set a reminder",
  "please remind me",
  "reminder",
  "a reminder",
  "another reminder",
  "set another reminder",
  "btw set a reminder",
  "btw you have to set a reminder",
  "set a reminder for",
  "set reminder for",
  "remind me for",
  "remind me to",
  "create a reminder",
  "create reminder",
  "add a reminder",
  "add reminder",
  "now",
  "right now",
  "today",
  "tomorrow",
  "ok",
  "okay",
]);

const NOISE_AND_FILLER_WORDS = new Set([
  "now",
  "right now",
  "today",
  "tomorrow",
  "ok",
  "okay",
  "for",
  "at",
  "on",
  "in",
  "to",
  "that",
  "about",
  "set",
  "a",
  "another",
  "reminder",
  "remind",
  "me",
  "please",
  "kindly",
  "can",
  "you",
  "could",
  "bro",
  "yaar",
  "btw",
  "have",
]);

function isGenericReminderTitle(title?: string): boolean {
  if (!title || typeof title !== "string") return true;
  const cleaned = title.trim().toLowerCase();
  if (cleaned.length <= 1) return true;
  if (GENERIC_REMINDER_COMMAND_TEXTS.has(cleaned)) return true;

  const wordTokens = cleaned
    .replace(/["'`;:,.\-!]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (wordTokens.length === 0) return true;

  const allNoise = wordTokens.every((w) => {
    if (NOISE_AND_FILLER_WORDS.has(w)) return true;
    if (GENERIC_REMINDER_COMMAND_TEXTS.has(w)) return true;
    if (/^\d+(:\d+)?$/.test(w)) return true;
    if (/^(am|pm)$/i.test(w)) return true;
    return false;
  });

  return allNoise;
}

export function normalizeTimeString(timeStr: string): string {
  if (!timeStr || typeof timeStr !== "string") return timeStr;

  return timeStr.replace(/\b(\d{1,2})[;.](\d{2})(?:\s*(am|pm))?\b/gi, (_match, h, m, ampm) => {
    const hours = parseInt(h, 10);
    const mins = parseInt(m, 10);
    if (hours < 0 || hours > 24 || mins < 0 || mins > 59) return _match;
    const ampmStr = ampm ? ` ${ampm.toUpperCase()}` : "";
    return `${hours}:${m}${ampmStr}`;
  });
}

export function isScreenshotActionCommand(input: string): boolean {
  if (!input) return false;
  const lower = input.toLowerCase().trim();

  // If asking to open or find the folder/dir, it's NOT a capture command
  if (/\b(folder|directory|dir)\b/i.test(lower)) return false;
  if (/^(?:open|show\s+me|go\s+to|take\s+me\s+to|find)\s+(?:the\s+|my\s+)?screenshots?$/i.test(lower)) return false;

  // Direct keywords
  if (/^(?:take\s+(?:a\s+)?screenshot|capture\s+(?:the\s+)?screen|take\s+(?:a\s+)?ss|screenshot|screenshort|screen\s*shot|ss)$/i.test(lower)) {
    return true;
  }

  const hasScreenshotTerm = /\b(screenshots?|screen\s*shot|capture\s+screen|screen\s+capture|ss)\b/i.test(lower);
  if (!hasScreenshotTerm) return false;

  // Action indicators: take, capture, snap, click, grab, lo, le, lelo, khicho, kheecho, karo, kar, abhi, now
  if (
    /\b(take|capture|snap|click|grab|get|record|khich[a-z]*|kheech[a-z]*|lo|le|lelo|karo|kar|nikal[a-z]*|now|abhi)\b/i.test(lower) ||
    /^(?:can\s+you|could\s+you|please|kindly|bro|yaar)\s+/i.test(lower)
  ) {
    return true;
  }

  const cleaned = lower.replace(/\b(please|kindly|can you|could you|bro|yaar|now|abhi|ek|the|a|my)\b/g, "").trim();
  if (/^(?:take\s+)?(?:screenshot|screen\s*shot|ss|capture\s+screen)$/i.test(cleaned)) {
    return true;
  }

  return false;
}

export function parseReminderCommand(input: string): FastCommand | null {
  const raw = input.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  // 1. QUERY / RETRIEVAL INTENTS
  if (
    /\b(list|show|get)\s+(all\s+)?(my\s+)?reminders?\b/i.test(raw) ||
    /\bshow\s+all\s+(my\s+)?reminders?\b/i.test(raw) ||
    /\bwhat\s+reminders?\s+do\s+i\s+have\b/i.test(raw) ||
    /\bdo\s+i\s+have\s+any\s+reminders?\b/i.test(raw) ||
    lower === "show my reminders" ||
    lower === "list reminders"
  ) {
    return {
      kind: "reminder",
      raw: input,
      action: "list",
      queryType: "all",
    };
  }

  if (
    /\b(tell\s+me\s+)?what\s+(did\s+you|was|is)\s+.*reminder\s*(for|about|set)?\b/i.test(raw) ||
    /\b(tell\s+me\s+)?(what\s+was\s+)?(the|my|that)\s+(last\s+)?reminder\s*(for|about|set)?\b/i.test(raw) ||
    /\b(tell\s+me\s+)?(what\s+was|what\s+is)\s+(the\s+last|my\s+last|last)\s+reminder\b/i.test(raw) ||
    /\btell\s+me\s+(what\s+was\s+)?(the\s+last|my\s+last|last)\s+reminder\b/i.test(raw) ||
    /\bwhat\s+did\s+you\s+(remind\s+me|set\s+a\s+reminder|set)\b/i.test(raw) ||
    /\bwhat\s+reminder\s+(did|was)\b/i.test(raw) ||
    /\bwhen\s+is\s+(my|the|that)\s+reminder\b/i.test(raw) ||
    /\bwhat\s+was\s+(the\s+last|my\s+last)\s+reminder\b/i.test(raw) ||
    /\bbtw\s+what\s+was\s+the\s+reminder\s+for\b/i.test(raw)
  ) {
    return {
      kind: "reminder",
      raw: input,
      action: "query",
      queryType: "latest",
    };
  }

  // 2. CANCEL / DELETE INTENTS
  if (/\b(cancel|delete|remove)\s+(the\s+)?reminder\b/i.test(raw)) {
    const query = raw.replace(/\b(cancel|delete|remove)\s+(the\s+)?reminder\s*(for|about)?\s*/i, "").trim();
    return {
      kind: "reminder",
      raw: input,
      action: "cancel",
      query,
    };
  }

  // 3. CREATE INTENTS
  const isCreateIntent =
    /\b(set|create|add)\s+(a\s+|another\s+)?reminder\b/i.test(raw) ||
    /\b(remind\s+me|remind)\b/i.test(raw) ||
    /\b(you\s+have\s+to\s+set\s+a\s+reminder)\b/i.test(raw);

  if (!isCreateIntent) {
    return null;
  }

  // Extract time expression:
  let timeInput: string | undefined = undefined;
  let rawTimeMatch: string | undefined = undefined;

  const relTimeMatch = raw.match(/\bin\s+\d+\s*(?:mins?|minutes?|hours?|hrs?|seconds?|secs?)\b/i);
  const dateTimeMatch = raw.match(/\b(?:today|tomorrow)\s+(?:at\s+)?\d{1,2}(?:[:;.]\d{2})?\s*(?:am|pm)?\b/i);
  const timeDateMatch = raw.match(/\b\d{1,2}(?:[:;.]\d{2})?\s*(?:am|pm)\s+(?:today|tomorrow)\b/i);
  const timePrepMatch = raw.match(/\b(?:at|for|on|about)\s+(\d{1,2}(?:[:;.]\d{2})?\s*(?:am|pm)?)\b/i);
  const timeAmPmMatch = raw.match(/\b\d{1,2}(?:[:;.]\d{2})?\s*(?:am|pm)\b/i);
  const timeColonMatch = raw.match(/\b\d{1,2}[:;.]\d{2}\b/i);
  const dateAloneMatch = raw.match(/\b(?:tomorrow|today)\b/i);

  if (relTimeMatch) {
    rawTimeMatch = relTimeMatch[0];
  } else if (dateTimeMatch) {
    rawTimeMatch = dateTimeMatch[0];
  } else if (timeDateMatch) {
    rawTimeMatch = timeDateMatch[0];
  } else if (timePrepMatch) {
    rawTimeMatch = timePrepMatch[1];
  } else if (timeAmPmMatch) {
    rawTimeMatch = timeAmPmMatch[0];
  } else if (timeColonMatch) {
    const parts = timeColonMatch[0].split(/[:;.]/);
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (h >= 0 && h <= 24 && m >= 0 && m <= 59) {
      rawTimeMatch = timeColonMatch[0];
    }
  } else if (dateAloneMatch) {
    rawTimeMatch = dateAloneMatch[0];
  }

  // Extract title:
  let cleaned = raw;

  if (rawTimeMatch) {
    const escapedTime = rawTimeMatch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned.replace(new RegExp(`\\b(?:at|for|on|in|about)\\s+${escapedTime}\\b`, "gi"), "");
    cleaned = cleaned.replace(new RegExp(`\\b${escapedTime}\\b`, "gi"), "");
    timeInput = normalizeTimeString(rawTimeMatch);
  }

  cleaned = cleaned
    .replace(/\b(?:btw|please|kindly|can\s+you|could\s+you|bro|yaar|you\s+have\s+to|now|right\s+now|today|tomorrow|ok|okay)\b/gi, "")
    .replace(/\b(?:set|create|add)\s+(?:a\s+|another\s+)?reminder\b/gi, "")
    .replace(/\b(?:remind\s+me|remind)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  // Repeatedly strip leading and trailing prepositions, conjunctions, and connective noise
  let prevCleaned = "";
  while (cleaned !== prevCleaned) {
    prevCleaned = cleaned;
    cleaned = cleaned
      .replace(/^\s*(?:to|that|for|at|about|and|then)\s+/i, "")
      .replace(/\s+(?:to|that|for|at|about|and|then|or|also)\s*$/i, "")
      .trim();
  }

  // Normalize app brand capitalization
  cleaned = cleaned.replace(/\byoutube\b/gi, "YouTube");
  cleaned = cleaned.replace(/\b(?:whatapp|whatsapp|watsapp)\b/gi, "WhatsApp");
  cleaned = cleaned.replace(/\bchrome\b/gi, "Chrome");
  cleaned = cleaned.replace(/\bpython\b/gi, "Python");

  const isGeneric = isGenericReminderTitle(cleaned);
  const title = isGeneric ? undefined : cleaned;

  return {
    kind: "reminder",
    raw: input,
    action: "create",
    title,
    timeInput,
  };
}

import { resolveSpecialFolder } from "../tools/laptop/folderResolver.js";

export function isDeterministicLaunchIntent(input: string): boolean {
  if (isScreenshotActionCommand(input)) return true;
  const rawTrimmed = input.trim();
  if (/^(https?:\/\/|www\.)[^\s]+/i.test(rawTrimmed)) return true;
  const normalized = normalizeCommandInput(input);
  if (normalized in DETERMINISTIC_COMMAND_MAP) return true;
  return (
    routeFastCommand(input) !== null ||
    /^(open|launch|start)\s+(notepad|notes?|chrome|google chrome|calculator|calc|youtube|downloads?)$/i.test(normalized) ||
    /^(?:volume\s*up|turn\s*(?:the\s*)?volume\s*up|turn\s*up\s*(?:the\s*)?volume|increase\s*(?:the\s*)?volume|raise\s*(?:the\s*)?volume|louder|make\s*it\s*louder|volume\s*badhao?|volume\s*badha\s*do|awaz\s*badhao?|awaaz\s*badhao?|volume\s*down|turn\s*(?:the\s*)?volume\s*down|turn\s*down\s*(?:the\s*)?volume|decrease\s*(?:the\s*)?volume|lower\s*(?:the\s*)?volume|reduce\s*(?:the\s*)?volume|quieter|make\s*it\s*quieter|volume\s*kam\s*karo?|volume\s*kam\s*kar\s*do|awaz\s*kam\s*karo?|awaaz\s*kam\s*karo?|mute|unmute|toggle\s*mute)$/i.test(normalized) ||
    /\b(set|create|add|cancel|delete|list|show)\s+(a\s+)?reminder\b/i.test(input) ||
    /^(remind me|remind)\b/i.test(input) ||
    parseYouTubeCommand(input) !== null
  );
}

const ACTION_VERB_REGEX = /^(?:please\s+|kindly\s+|can\s+you\s+|could\s+you\s+|bro\s+|yaar\s+)*(open\s+up|bring\s+up|take\s+me\s+to|go\s+to|show\s+me|display|open|launch|start|run|find|locate)\s+(.+)$/i;
const WEB_INFO_TARGET_REGEX = /\b(information|info|news|articles?|jobs?|frameworks?|tutorials?|guides?|about|how\s+to|what\s+is|who\s+is|latest|tools?|software|definition|meaning)\b/i;
const WEB_PROVIDER_TARGET_REGEX = /\b(on\s+google|on\s+youtube|google\s+search|web\s+search|online|internet|wikipedia|github|amazon)\b/i;

function normalizeWriteTargetApp(rawApp: string): string {
  const lower = rawApp.trim().toLowerCase().replace(/\s+/g, " ");
  if (lower === "note pad" || lower === "notepad" || lower === "notepads" || lower === "notpad" || lower === "notepad.exe") {
    return "notepad";
  }
  if (lower === "notepad++" || lower === "npp") return "notepad++";
  if (lower === "wordpad" || lower === "word pad") return "wordpad";
  if (lower === "word" || lower === "ms word" || lower === "microsoft word" || lower === "winword") return "word";
  if (lower === "vscode" || lower === "vs code" || lower === "visual studio code") return "vscode";
  if (lower === "sticky note" || lower === "sticky notes") return "sticky notes";
  if (lower === "sublime" || lower === "sublime text") return "sublime";
  if (lower === "notes app" || lower === "apple notes" || lower === "samsung notes") return "notes";
  return lower;
}

function cleanGenerationPrompt(rawPrompt: string): string {
  return rawPrompt
    .trim()
    .replace(/^(?:(?:ok|okay|now|abhi|ab|bhai|bro|yaar|hey|hello|please|kindly)\s+)+/i, "")
    .replace(/^(?:ell|tll)\s+me\b/i, "tell me")
    .replace(/\bthings\s+you\s+can\s+do\s+it\b/i, "things you can do")
    .replace(/(?:\s+(?:now|abhi|ab|please|bro|yaar))+\s*[.!?]*$/i, "")
    .trim();
}

function classifyWritePayload(
  rawPayload: string,
  preferGenerate = false
): { mode: "generate" | "literal" | "from_history"; prompt?: string; text?: string } {
  const trimmed = rawPayload.trim().replace(/(?:\s+(?:now|abhi|ab|please|bro|yaar))+\s*[.!?]*$/i, "").trim();

  // Quoted text is strictly literal
  const quoteMatch = trimmed.match(/^["'“]([\s\S]+)["'”]$/);
  if (quoteMatch && quoteMatch[1].trim()) {
    return { mode: "literal", text: quoteMatch[1].trim() };
  }

  // Referential pronouns reuse previous assistant response
  if (
    /^(?:it|this|that|everything|all(?:\s+of\s+(?:it|this|that))?|the\s+(?:same|answer|response|result|above|last\s+(?:answer|response|message))|your\s+(?:answer|response|last\s+message)|whatever\s+you\s+(?:just\s+)?said|isey|ise|isko|usse|use|usko|ye|yeh)$/i.test(
      trimmed
    )
  ) {
    return { mode: "from_history" };
  }

  const generativePattern =
    /^(?:tell|explain|describe|summarize|list|generate|create|draft|compose|brainstorm|suggest|prepare|make|compare|batao|bata|samjhao|what|how|why|who|which|when|where)\b|^(?:about|on|regarding|for)\s+\S+|^(?:something|anything|kuch|thoda)\b|^(?:a|an|some|the|one|two|three|five|\d+|my|your|apni|apna|apne|ek)\s+(?:[a-z0-9-]+\s+){0,3}(?:summary|essay|poem|shayari|letter|application|email|mail|story|kahani|article|blog|report|notes?|todo|checklist|list|code|function|script|program|bio|caption|tweet|post|description|intro|introduction|capabilit\w*|features?|skills?|things?|jokes?|quotes?|speech|plan|roadmap|schedule|points?|paragraphs?|tips|ideas|steps|guide|tutorial|definition|difference|questions?|answers?|commands?|recipes?|lyrics|wish|greeting|invitation|notice|agenda|minutes|resume|cover\s+letter)\b|\b(?:capabilities|features|ke\s+baare\s+me(?:in)?|ke\s+bare\s+me(?:in)?|ke\s+upar|par\s+kuch|batao|bata\s*do|bata\s*de|samjhao|samjha\s*do|likh\s*ke\s+batao|kya\s+hota|kya\s+hai|kaise|kyu|kyon|kaun|kaisa|kitna|apne\s+baare|apne\s+bare)\b/i;

  if (preferGenerate || generativePattern.test(trimmed)) {
    return { mode: "generate", prompt: cleanGenerationPrompt(trimmed) };
  }

  return { mode: "literal", text: trimmed };
}

/**
 * Parses compound or direct commands that ask Creater AI to answer/generate/copy content
 * and write it directly into Notepad (or another desktop editor).
 */
export function parseAppComposeCommand(input: string): Extract<FastCommand, { kind: "app_compose" }> | null {
  const rawTrimmed = input.trim();
  if (!rawTrimmed) return null;

  // Match explicit desktop writing/editor apps; require ms/microsoft/winword or prep+word to avoid English idioms like "in a word"
  const explicitApps =
    "notepad\\+\\+|npp|notepads?|note\\s*pad|notpad|notepad\\.exe|word\\s*pad|wordpad|ms\\s*word|microsoft\\s*word|winword|vs\\s*code|vscode|visual\\s*studio\\s*code|sticky\\s*notes?|obsidian|notion|sublime\\s*text|sublime|notes\\s+app|apple\\s*notes|samsung\\s*notes";
  const prepWithWord = `${explicitApps}|word`;
  const prepPattern = "(?:in|into|on|to|inside|bin|me|pe|par)";
  const writeVerbPattern =
    "(?:write|type|paste|put|save|add|insert|note\\s+down|jot\\s+down|daal\\s*do|daal\\s*de|dal\\s*do|dal\\s*de|likh\\s*do|likh\\s*de|likh\\s*dena|likhwa\\s*do|likhwa\\s*de|likh|likho|type\\s*karo|type\\s*kar|type\\s*karde|type\\s*kar\\s*do|paste\\s*karo|paste\\s*kar|paste\\s*karde|paste\\s*kar\\s*do|save\\s*karo|save\\s*kar|save\\s*karde|save\\s*kar\\s*do)";
  const fillerSuffix = "(?:\\s+(?:now|please|bro|yaar|abhi|ab))*\\s*[.!?]*";

  // 1. App-first compound: "open notepad and write/tell me ...", "open vscode and write a ts script"
  const appFirstRegex = new RegExp(
    `^(?:(?:ok|okay|now|abhi|ab|bhai|bro|yaar|hey|hello|please|kindly|can\\s+you|could\\s+you)\\s+)*(?:open|launch|start)\\s+(?:the\\s+)?(${prepWithWord})\\s+(?:and|aur|&|to)\\s+(.+)${fillerSuffix}$`,
    "i"
  );
  const appFirstMatch = rawTrimmed.match(appFirstRegex);
  if (appFirstMatch && appFirstMatch[1] && appFirstMatch[2]) {
    const app = normalizeWriteTargetApp(appFirstMatch[1]);
    const rest = appFirstMatch[2].trim();
    const stripWriteLead = rest.match(
      /^(?:write|type|paste|put|save|add|insert|note\s+down|jot\s+down|likh\s*do|likh\s*de|likh\s*dena|likh|likho|daal\s*do|daal\s*de|type\s*karo|type\s*kar)\s+(?:down\s+)?(.+?)(?:\s+(?:inside|in|into|there|me|pe))?$/i
    );
    if (stripWriteLead && stripWriteLead[1]) {
      const inner = stripWriteLead[1].trim();
      const classified = classifyWritePayload(inner, false);
      return { kind: "app_compose", raw: input, app, ...classified };
    }
    const classified = classifyWritePayload(rest, true);
    return { kind: "app_compose", raw: input, app, ...classified };
  }

  // 2. Content-first compound: "tell me what things you can do and write it in notepad"
  const contentAndWriteRegex = new RegExp(
    `^(.+?)\\s+(?:and(?:\\s+then)?|aur|phir|fir|&|,)\\s+(?:also\\s+|directly\\s+|sidhe\\s+|then\\s+)?${writeVerbPattern}\\s+(?:down\\s+)?(?:(?:it|this|that|everything|all(?:\\s+of\\s+(?:it|that|this))?|isey|ise|isko|yeh|ye|answer|response|result)\\s+)?(?:now\\s+|please\\s+|bro\\s+|yaar\\s+|directly\\s+|sidhe\\s+)*${prepPattern}\\s+(?:the\\s+)?(${prepWithWord})${fillerSuffix}$`,
    "i"
  );
  const cwMatch = rawTrimmed.match(contentAndWriteRegex);
  if (cwMatch && cwMatch[1] && cwMatch[2]) {
    const app = normalizeWriteTargetApp(cwMatch[2]);
    const prompt = cleanGenerationPrompt(cwMatch[1]);
    if (prompt && !/^(?:open|launch|start)\s+/i.test(prompt)) {
      return { kind: "app_compose", raw: input, app, mode: "generate", prompt };
    }
  }

  // 3. Hinglish content + "<app> me likho": "apni capabilities batao aur usse sidhe notepad me likh do"
  const hinglishCompoundRegex = new RegExp(
    `^(.+?)\\s+(?:and(?:\\s+then)?|aur|phir|fir|&|,)\\s+(?:(?:usse|use|usko|isey|ise|isko|it|this|that)\\s+)?(?:sidhe\\s+|directly\\s+)?(?:the\\s+)?(${prepWithWord})\\s+(?:me|pe|par|in)\\s+(?:it|this|isey|ise|isko|ye|yeh\\s+)?${writeVerbPattern}(?:\\s+(?:it|this|that|karo|do|de))?${fillerSuffix}$`,
    "i"
  );
  const hcMatch = rawTrimmed.match(hinglishCompoundRegex);
  if (hcMatch && hcMatch[1] && hcMatch[2]) {
    const app = normalizeWriteTargetApp(hcMatch[2]);
    const prompt = cleanGenerationPrompt(hcMatch[1]);
    if (prompt && !/^(?:open|launch|start)\s+/i.test(prompt)) {
      return { kind: "app_compose", raw: input, app, mode: "generate", prompt };
    }
  }

  // 4. Direct write/explain into app: "write an essay in word", "draft a cover letter in notepad", "explain AI in notepad"
  const directWriteRegex = new RegExp(
    `^(?:(?:ok|okay|now|abhi|ab|bhai|bro|yaar|hey|hello|please|kindly|can\\s+you|could\\s+you)\\s+)*(?:${writeVerbPattern}|tell\\s+me|explain|describe|summarize|list|generate|create|draft|compose|prepare|make|brainstorm|suggest|batao|samjhao)\\s+(?:down\\s+)?(.+?)\\s+${prepPattern}\\s+(?:the\\s+)?(${prepWithWord})${fillerSuffix}$`,
    "i"
  );
  const dwMatch = rawTrimmed.match(directWriteRegex);
  if (dwMatch && dwMatch[1] && dwMatch[2]) {
    const app = normalizeWriteTargetApp(dwMatch[2]);
    const rawClause = dwMatch[0].trim();
    const startsWithGenVerb =
      /^(?:(?:ok|okay|now|abhi|ab|bhai|bro|yaar|hey|hello|please|kindly|can\s+you|could\s+you)\s+)*(?:tell\s+me|explain|describe|summarize|list|generate|create|draft|compose|prepare|make|brainstorm|suggest|batao|samjhao)\b/i.test(
        rawClause
      );
    const payloadRaw = dwMatch[1].trim();
    const classified = startsWithGenVerb
      ? { mode: "generate" as const, prompt: cleanGenerationPrompt(rawClause.replace(new RegExp(`\\s+${prepPattern}\\s+(?:the\\s+)?(${prepWithWord})${fillerSuffix}$`, "i"), "")) }
      : classifyWritePayload(payloadRaw, false);
    return { kind: "app_compose", raw: input, app, ...classified };
  }

  // 5. App-prep-first Hinglish: "notepad me apni capabilities likh do" or "apni capabilities notepad me likho"
  const appMeFirstRegex = new RegExp(
    `^(?:(?:ok|okay|now|abhi|ab|bhai|bro|yaar|hey|hello|please|kindly)\\s+)*(?:the\\s+)?(${prepWithWord})\\s+(?:me|pe|par|in)\\s+(.+?)\\s+${writeVerbPattern}${fillerSuffix}$`,
    "i"
  );
  const amMatch = rawTrimmed.match(appMeFirstRegex);
  if (amMatch && amMatch[1] && amMatch[2]) {
    const app = normalizeWriteTargetApp(amMatch[1]);
    const classified = classifyWritePayload(amMatch[2], false);
    return { kind: "app_compose", raw: input, app, ...classified };
  }

  const suffixAppLikhRegex = new RegExp(
    `^(?:(?:ok|okay|now|abhi|ab|bhai|bro|yaar|hey|hello|please|kindly)\\s+)*(.+?)\\s+(?:the\\s+)?(${prepWithWord})\\s+(?:me|pe|par|in)\\s+${writeVerbPattern}${fillerSuffix}$`,
    "i"
  );
  const salMatch = rawTrimmed.match(suffixAppLikhRegex);
  if (salMatch && salMatch[1] && salMatch[2]) {
    const app = normalizeWriteTargetApp(salMatch[2]);
    const classified = classifyWritePayload(salMatch[1], true);
    return { kind: "app_compose", raw: input, app, ...classified };
  }

  // 6. Content + verb + app + postposition: "apni capabilities likh do notepad me" (for standalone "word" require prep/postposition)
  const verbBeforeAppSuffixRegex = new RegExp(
    `^(?:(?:ok|okay|now|abhi|ab|bhai|bro|yaar|hey|hello|please|kindly)\\s+)*(.+?)\\s+${writeVerbPattern}\\s+(?:(?:it|this|isey|ise|isko|ye|yeh)\\s+)?(?:${prepPattern}\\s+(?:the\\s+)?(${prepWithWord})|(?:the\\s+)?(${explicitApps}))(?:\\s+(?:me|pe|par))?${fillerSuffix}$`,
    "i"
  );
  const vbaMatch = rawTrimmed.match(verbBeforeAppSuffixRegex);
  const vbaApp = vbaMatch?.[2] || vbaMatch?.[3];
  if (vbaMatch && vbaMatch[1] && vbaApp) {
    const app = normalizeWriteTargetApp(vbaApp);
    const classified = classifyWritePayload(vbaMatch[1], false);
    return { kind: "app_compose", raw: input, app, ...classified };
  }

  return null;
}

export function routeFastCommand(input: string): FastCommand | null {
  const rawTrimmed = input.trim();
  log.info("Fast router received command", { input, rawTrimmed });

  if (!rawTrimmed) return null;

  // Direct URL matching BEFORE normalizeCommandInput strips URL punctuation
  const directUrlMatch = rawTrimmed.match(/^(https?:\/\/[^\s]+|www\.[^\s]+)/i);
  if (directUrlMatch) {
    const rawUrl = directUrlMatch[0];
    const fullUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    return {
      kind: "open_url",
      raw: input,
      url: fullUrl,
    };
  }

  // Memory command matching
  const memStore = parseMemoryStoreInput(input);
  if (memStore) {
    return {
      kind: "memory_store",
      raw: input,
      category: memStore.category,
      key: memStore.key,
      value: memStore.value,
    };
  }

  if (isMemoryListInput(input)) {
    return {
      kind: "memory_list",
      raw: input,
    };
  }

  const memQuery = parseMemoryQueryInput(input);
  if (memQuery) {
    return {
      kind: "memory_query",
      raw: input,
      query: memQuery,
    };
  }

  // Screenshot action commands take priority over folder matching (e.g. "screenshot", "take a screenshot", "screenshot lo", "screenshot lelo")
  if (isScreenshotActionCommand(rawTrimmed) || isScreenshotActionCommand(input)) {
    return { kind: "screenshot", raw: input };
  }

  // CUA: Screen inspection / Active window query (e.g. "what is currently open on my screen", "what's on my screen", "inspect active window")
  const screenQueryPattern = /^(?:what(?:'s|\s+is)\s+(?:currently\s+)?(?:open\s+on|open\s+in|on)\s+(?:my\s+)?screen|what\s+is\s+open(?:\s+on\s+(?:the\s+)?screen)?|inspect\s+(?:the\s+|my\s+)?(?:active\s+)?window|inspect\s+(?:the\s+|my\s+)?screen|check\s+(?:my\s+)?screen|active\s+window|screen\s*pe\s*kya\s*(?:hai|chal\s*raha\s*hai))\??$/i;
  if (screenQueryPattern.test(rawTrimmed) || screenQueryPattern.test(input.trim())) {
    return { kind: "active_window", raw: input };
  }

  // CUA: Mouse click or move (e.g. "click at 500 500", "move mouse to 400 300", "click 200 200")
  const clickMatch = rawTrimmed.match(/^(?:click\s+(?:at|on)?\s*|move\s+mouse\s+(?:to)?\s*)(\d+)[,\s]+(\d+)$/i);
  if (clickMatch && clickMatch[1] && clickMatch[2]) {
    return {
      kind: "cua_click",
      raw: input,
      x: parseInt(clickMatch[1], 10),
      y: parseInt(clickMatch[2], 10),
    };
  }

  // Compound or direct desktop writing (e.g. "tell me what things you can do and write it in notepad", "open vscode and write a ts script")
  // Check before cua_type so generative/history "type a poem in notepad" or "type it in word" uses app_compose, while literal "type Hello into notepad" still uses cua_type.
  const appComposeCmd = parseAppComposeCommand(rawTrimmed);
  if (appComposeCmd && (appComposeCmd.mode !== "literal" || !/^type\s+/i.test(rawTrimmed))) {
    return appComposeCmd;
  }

  // CUA: Type text into active window (e.g. "type hello into notepad", "type Hello Rachit")
  const typeMatch = rawTrimmed.match(/^type\s+(.+?)(?:\s+(?:in|into|on)\s+(?:the\s+)?(?:active\s+)?(window|notepad|screen|[a-z0-9_-]+))?$/i);
  if (typeMatch && typeMatch[1] && !typeMatch[1].toLowerCase().startsWith("of ") && !typeMatch[1].toLowerCase().startsWith("script")) {
    const rawTarget = typeMatch[2] ? typeMatch[2].trim().toLowerCase() : undefined;
    const targetApp = rawTarget && !["window", "screen"].includes(rawTarget) ? rawTarget : undefined;
    return {
      kind: "cua_type",
      raw: input,
      text: typeMatch[1].trim(),
      ...(targetApp ? { targetApp } : {}),
    };
  }

  if (appComposeCmd) {
    return appComposeCmd;
  }

  // Multi-MCP: List servers (e.g. "list mcp servers", "list all mcp servers", "show mcp servers")
  if (/^(?:list|show)\s+(?:all\s+)?mcp\s+servers?$/i.test(rawTrimmed) || /^(?:list|show)\s+(?:all\s+)?mcp\s+servers?$/i.test(input.trim())) {
    return { kind: "mcp_list", raw: input };
  }

  // Social messaging parser (e.g. "open linkedin and message to ojas -how are you bro", "dm ojas on insta: hey", "message ojas on linkedin -hi")
  const pSocial1 = /^(?:(?:ok|okay|now|abhi|ab|bhai|bro|yaar|hey|hello|please|kindly|can\s+you|could\s+you)\s+)*open\s+([a-z0-9_-]+)\s+and\s+(?:send\s+(?:a\s+)?message|message|dm|text)\s+(?:to\s+)?([a-z0-9_.\s]+?)\s*[-:]\s*(.+)$/i;
  const pSocial2 = /^(?:(?:ok|okay|now|abhi|ab|bhai|bro|yaar|hey|hello|please|kindly|can\s+you|could\s+you)\s+)*(?:send\s+(?:a\s+)?message|message|dm|text)\s+(?:to\s+)?([a-z0-9_.\s]+?)\s+(?:on|in)\s+([a-z0-9_-]+)\s*[-:]\s*(.+)$/i;
  const socialMatch1 = rawTrimmed.match(pSocial1);
  const socialMatch2 = !socialMatch1 ? rawTrimmed.match(pSocial2) : null;
  if (socialMatch1 || socialMatch2) {
    let platform = (socialMatch1 ? socialMatch1[1] : socialMatch2![2]).toLowerCase().trim();
    const recipient = (socialMatch1 ? socialMatch1[2] : socialMatch2![1]).trim();
    const message = (socialMatch1 ? socialMatch1[3] : socialMatch2![3]).trim();

    // Normalize common platform names & typos
    if (platform === "linkedln" || platform === "linkdin" || platform === "linkedin") platform = "linkedin";
    else if (platform === "insta" || platform === "ig" || platform === "instagram") platform = "instagram";
    else if (platform === "wa" || platform === "whatsapp") platform = "whatsapp";
    else if (platform === "tw" || platform === "twitter" || platform === "x") platform = "twitter";
    else if (platform === "tg" || platform === "telegram") platform = "telegram";

    return {
      kind: "social_message",
      raw: input,
      platform,
      recipient,
      message,
    };
  }

  // Check YouTube command parsing BEFORE general web actions
  const ytParsed = parseYouTubeCommand(input);
  if (ytParsed) {
    return {
      kind: "youtube",
      raw: input,
      action: ytParsed.action,
      ...(ytParsed.query ? { query: ytParsed.query } : {}),
      ...(ytParsed.selection ? { selection: ytParsed.selection } : {}),
      ...(ytParsed.comment ? { comment: ytParsed.comment } : {}),
      ...(ytParsed.mediaSubtype ? { mediaSubtype: ytParsed.mediaSubtype } : {}),
      ...(ytParsed.subscribe ? { subscribe: ytParsed.subscribe } : {}),
      ...(ytParsed.commentOnly ? { commentOnly: ytParsed.commentOnly } : {}),
    };
  }

  // Universal autonomous web operator parser
  // Matches "open <site> and <goal>", "go to <site> and <goal>" with arbitrary filler words
  // e.g. "ok now can you open linkedin and say hello to ojas", "open github and search deepseek-v3"
  const pWebAct = /^(?:(?:ok|okay|now|abhi|ab|bhai|bro|yaar|hey|hello|please|kindly|can\s+you|could\s+you)\s+)*(?:open|go\s+to)\s+([a-z0-9_.-]+)\s+and\s+(.+)$/i;
  const webActMatch = rawTrimmed.match(pWebAct);
  if (
    webActMatch &&
    !["notepad", "calculator", "calc", "paint", "explorer", "cmd", "terminal", "vscode", "code", "youtube"].includes(
      webActMatch[1].toLowerCase()
    )
  ) {
    const site = webActMatch[1].toLowerCase().trim();
    const actionGoal = webActMatch[2].trim();
    return {
      kind: "browser_act",
      raw: input,
      goal: `${site}: ${actionGoal}`,
      targetUrl: site.startsWith("http") ? site : `https://${site}.com`,
    };
  }

  // Check direct special folder match first on raw or trimmed input
  const directFolderMatch = resolveSpecialFolder(rawTrimmed);
  if (directFolderMatch) {
    return {
      kind: "open_path",
      raw: input,
      path: directFolderMatch.path,
    };
  }

  // Reminder command matching
  const reminderCmd = parseReminderCommand(input);
  if (reminderCmd) {
    return reminderCmd;
  }

  const normalized = normalizeCommandInput(input);

  const deterministicCommand = DETERMINISTIC_COMMAND_MAP[normalized];
  if (deterministicCommand) {
    return { ...deterministicCommand, raw: input };
  }

  // Exact volume percentage setting (e.g. "volume ko 70 karo", "volume 70%", "set volume to 70")
  const exactVolumeMatch = normalized.match(
    /^(?:(?:set|change|put|make|keep|turn)\s+(?:the\s+)?(?:volume|awaz|awaaz)(?:\s+(?:to|at|pe|par))?\s+(\d{1,3})%?|(?:volume|awaz|awaaz)(?:\s+ko)?\s+(\d{1,3})%?(?:\s*(?:pe|par|karo?|kar\s*do|set\s*karo?|rakho?))?|(?:set\s+)?(?:volume|awaz|awaaz)\s+(?:to|at)\s+(\d{1,3})%?)$/i
  );
  if (exactVolumeMatch) {
    const rawVal = exactVolumeMatch[1] || exactVolumeMatch[2] || exactVolumeMatch[3];
    if (rawVal) {
      const num = parseInt(rawVal, 10);
      if (!isNaN(num) && num >= 0 && num <= 100) {
        return { kind: "volume", raw: input, direction: "set", value: num };
      }
    }
  }

  if (
    /^(?:volume\s*(?:up|high|tez)|turn\s*(?:the\s*)?volume\s*up|turn\s*up\s*(?:the\s*)?volume|increase\s*(?:the\s*)?volume|raise\s*(?:the\s*)?volume|louder|make\s*it\s*louder|volume\s*(?:badhao?|badho|badha\s*do|badha|high\s*karo?|tez\s*karo?)|awaz\s*(?:badhao?|badho|badha\s*do|badha|tez\s*karo?)|awaaz\s*(?:badhao?|badho|badha\s*do|badha|tez\s*karo?))$/i.test(
      normalized
    )
  ) {
    return { kind: "volume", raw: input, direction: "up" };
  }

  if (
    /^(?:volume\s*(?:down|low|slow|dheema)|turn\s*(?:the\s*)?volume\s*down|turn\s*down\s*(?:the\s*)?volume|decrease\s*(?:the\s*)?volume|lower\s*(?:the\s*)?volume|reduce\s*(?:the\s*)?volume|quieter|make\s*it\s*quieter|volume\s*(?:kam\s*karo?|kam\s*kar\s*do|kam|low\s*karo?|slow\s*karo?|dheema\s*karo?|ghatao?)|awaz\s*(?:kam\s*karo?|kam\s*kar\s*do|kam|low\s*karo?|slow\s*karo?|dheema\s*karo?|ghatao?)|awaaz\s*(?:kam\s*karo?|kam\s*kar\s*do|kam|low\s*karo?|slow\s*karo?|dheema\s*karo?|ghatao?))$/i.test(
      normalized
    )
  ) {
    return { kind: "volume", raw: input, direction: "down" };
  }

  if (/^(?:mute(?:\s*(?:the\s*)?volume)?|toggle\s*mute|mute\s*karo?|awaz\s*band\s*karo?)$/i.test(normalized)) {
    return { kind: "volume", raw: input, direction: "mute" };
  }

  if (/^(?:unmute(?:\s*(?:the\s*)?volume)?|unmute\s*karo?)$/i.test(normalized)) {
    return { kind: "volume", raw: input, direction: "unmute" };
  }

  if (isScreenshotActionCommand(normalized) || isScreenshotActionCommand(input)) {
    return { kind: "screenshot", raw: input };
  }

  if (/^(open|launch|start)\s+browser$/i.test(normalized) || /^(open|launch|start)\s+web\s+browser$/i.test(normalized)) {
    return { kind: "browser_home", raw: input };
  }

  if (/^(close|quit|exit)\s+(the\s+)?(browser|app)$/i.test(normalized)) {
    return { kind: "close_app", raw: input, app: "browser" };
  }

  if (/^(close|quit|exit)\s+/.test(normalized)) {
    const target = stripOpenVerb(normalized.replace(/^(close|quit|exit)\s+/, ""));
    if (target) {
      return { kind: "close_app", raw: input, app: target };
    }
  }

  // Natural Action Verb & Special Folder Parsing
  const actionMatch = rawTrimmed.match(ACTION_VERB_REGEX);
  if (actionMatch) {
    const target = actionMatch[2]!.trim();

    // Check special folder resolution on target
    const folderMatch = resolveSpecialFolder(target);
    if (folderMatch) {
      return {
        kind: "open_path",
        raw: input,
        path: folderMatch.path,
      };
    }

    // Explicit path syntax
    if (target.includes("\\") || target.includes("/") || target.startsWith("~") || target.includes(":") || target.startsWith("./")) {
      return {
        kind: "open_path",
        raw: input,
        path: target,
      };
    }

    // Check app aliases
    const alias = APP_ALIASES.find((entry) => entry.match.test(target));
    if (alias) {
      return { kind: "open_app", raw: input, app: alias.app };
    }

    // Check file or folder keywords (e.g., "the file report.pdf", "a folder called projects", "folder projects")
    const fileFolderMatch = target.match(/^(?:the\s+file\s+|file\s+|a\s+folder\s+called\s+|the\s+folder\s+|folder\s+)(.+)$/i);
    if (fileFolderMatch) {
      const subTarget = fileFolderMatch[1]!.trim();
      if (subTarget) {
        return {
          kind: "open_path",
          raw: input,
          path: subTarget,
        };
      }
    }

    // If target has web/information indicators or web provider specifiers, return null (handled by web search)
    if (WEB_INFO_TARGET_REGEX.test(target) || WEB_PROVIDER_TARGET_REGEX.test(target)) {
      return null;
    }
  }

  if (/^(browser|web)$/i.test(normalized)) {
    return { kind: "browser_home", raw: input };
  }

  return null;
}

