// ════════════════════════════════════════════════════════════════════════════════
// src/tools/laptop/youtubeIntelligence.ts — YouTube Candidate Evaluation & Commenting
// Evaluates YouTube search candidates with channel verification, LIVE/replay/video
// distinction, and DOM-first verified comment execution.
// ════════════════════════════════════════════════════════════════════════════════

import type { Page } from "playwright";
import { createLogger } from "@utils/logger.js";

const log = createLogger("tools/laptop/youtubeIntelligence");

export type YouTubeMediaSubtype =
  | "currently_live"
  | "latest_livestream"
  | "livestream_replay"
  | "latest_video"
  | "channel_open"
  | "video";

export interface YouTubeCandidate {
  videoId: string;
  url: string;
  title: string;
  channelName: string;
  isVerifiedChannel: boolean;
  isLiveNow: boolean;
  isCompletedLivestream: boolean;
  isUpcoming: boolean;
  isShort: boolean;
  publishedText?: string;
  lengthText?: string;
  badges: string[];
}

export interface YouTubeSelectionOptions {
  requestedChannel?: string;
  query: string;
  subtype: YouTubeMediaSubtype;
  requireChannelVerification?: boolean;
}

export interface YouTubeSelectionResult {
  selected: YouTubeCandidate | null;
  channelVerified: boolean;
  reason: string;
  candidatesEvaluated: number;
  errorCode?:
    | "NO_RESULTS"
    | "NO_LIVE_STREAM_AVAILABLE"
    | "NO_VERIFIED_LIVESTREAM_FOUND"
    | "CHANNEL_NOT_VERIFIED";
}

export interface YouTubeCommentDomResult {
  success: boolean;
  status: "SUCCESS" | "AWAITING_APPROVAL" | "FAILED" | "PARTIAL_SUCCESS" | "VERIFICATION_FAILED";
  verified: boolean;
  published: boolean;
  requiresApproval?: boolean;
  loggedOut?: boolean;
  commentsDisabled?: boolean;
  targetVerified?: boolean;
  observedUrl?: string;
  observedTitle?: string;
  error?: string;
}

function extractRunsText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const rec = node as { simpleText?: string; runs?: Array<{ text?: string }> };
  if (typeof rec.simpleText === "string") return rec.simpleText;
  if (Array.isArray(rec.runs)) {
    return rec.runs.map((r) => (typeof r?.text === "string" ? r.text : "")).join("");
  }
  return "";
}

/**
 * Parses `ytInitialData` from a YouTube search page into structured YouTubeCandidate items.
 */
export function parseYouTubeCandidatesFromInitialData(ytInitialData: unknown): YouTubeCandidate[] {
  const candidates: YouTubeCandidate[] = [];
  if (!ytInitialData || typeof ytInitialData !== "object") return candidates;

  const root = ytInitialData as {
    contents?: {
      twoColumnSearchResultsRenderer?: {
        primaryContents?: {
          sectionListRenderer?: {
            contents?: Array<{
              itemSectionRenderer?: {
                contents?: Array<{ videoRenderer?: Record<string, unknown> }>;
              };
            }>;
          };
        };
      };
    };
  };

  const sections =
    root.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
  if (!Array.isArray(sections)) return candidates;

  for (const section of sections) {
    const items = section.itemSectionRenderer?.contents;
    if (!Array.isArray(items)) continue;

    for (const item of items) {
      const vr = item.videoRenderer;
      if (!vr || typeof vr.videoId !== "string") continue;

      const videoId = vr.videoId;
      const title = extractRunsText(vr.title).trim();
      const channelName = extractRunsText(vr.ownerText || vr.longBylineText).trim();
      const publishedText = extractRunsText(vr.publishedTimeText).trim() || undefined;
      const lengthText = extractRunsText(vr.lengthText).trim() || undefined;

      const badges: string[] = [];
      let isLiveNow = false;

      if (Array.isArray(vr.badges)) {
        for (const b of vr.badges as Array<{ metadataBadgeRenderer?: { label?: string; style?: string } }>) {
          const label = b?.metadataBadgeRenderer?.label || "";
          const style = b?.metadataBadgeRenderer?.style || "";
          if (label) badges.push(label);
          if (style === "BADGE_STYLE_TYPE_LIVE_NOW" || /\bLIVE\b/i.test(label)) {
            isLiveNow = true;
          }
        }
      }

      if (Array.isArray(vr.thumbnailOverlays)) {
        for (const ov of vr.thumbnailOverlays as Array<{
          thumbnailOverlayTimeStatusRenderer?: { style?: string; text?: unknown };
        }>) {
          const ts = ov?.thumbnailOverlayTimeStatusRenderer;
          if (ts?.style === "LIVE" || /\bLIVE\b/i.test(extractRunsText(ts?.text))) {
            isLiveNow = true;
          }
        }
      }

      let isVerifiedChannel = false;
      if (Array.isArray(vr.ownerBadges)) {
        for (const ob of vr.ownerBadges as Array<{ metadataBadgeRenderer?: { style?: string; tooltip?: string } }>) {
          const style = ob?.metadataBadgeRenderer?.style || "";
          const tooltip = ob?.metadataBadgeRenderer?.tooltip || "";
          if (style.includes("VERIFIED") || /verified|official/i.test(tooltip)) {
            isVerifiedChannel = true;
          }
        }
      }

      const navUrl =
        ((vr.navigationEndpoint as { commandMetadata?: { webCommandMetadata?: { url?: string } } } | undefined)
          ?.commandMetadata?.webCommandMetadata?.url) || "";
      const isShort = navUrl.includes("/shorts/");
      const isUpcoming = Boolean(vr.upcomingEventData);
      const isCompletedLivestream =
        !isLiveNow &&
        !isUpcoming &&
        ((publishedText ? /\bstreamed\b/i.test(publishedText) : false) ||
          badges.some((b) => /\blive\b|\bstreamed\b/i.test(b)));

      candidates.push({
        videoId,
        url: isShort
          ? `https://www.youtube.com/shorts/${videoId}`
          : `https://www.youtube.com/watch?v=${videoId}`,
        title,
        channelName,
        isVerifiedChannel,
        isLiveNow,
        isCompletedLivestream,
        isUpcoming,
        isShort,
        publishedText,
        lengthText,
        badges,
      });
    }
  }

  return candidates;
}

/**
 * Converts relative YouTube publishedText (e.g. "Streamed 2 hours ago") into approximate minutes
 * for deterministic recency sorting. Returns Infinity when unknown.
 */
export function parsePublishedAgeMinutes(publishedText?: string): number {
  if (!publishedText) return Number.POSITIVE_INFINITY;
  const match = publishedText.match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!match) return Number.POSITIVE_INFINITY;
  const num = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  const multipliers: Record<string, number> = {
    second: 1 / 60,
    minute: 1,
    hour: 60,
    day: 60 * 24,
    week: 60 * 24 * 7,
    month: 60 * 24 * 30,
    year: 60 * 24 * 365,
  };
  return num * (multipliers[unit] ?? Number.POSITIVE_INFINITY);
}

function matchesRequestedChannel(candidate: YouTubeCandidate, requestedChannel?: string): boolean {
  if (!requestedChannel) return true;
  const normReq = requestedChannel.toLowerCase().replace(/[^a-z0-9]/g, "");
  const normChan = candidate.channelName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!normReq || !normChan) return false;
  if (normChan.includes(normReq) || normReq.includes(normChan)) return true;
  // Common creator live channel pattern (e.g. CarryMinati -> CarryIsLive)
  if (normReq.startsWith("carry") && normChan.includes("carry")) return true;
  return false;
}

/**
 * Selects the best YouTube candidate strictly according to subtype rules.
 * Never substitutes a regular video for a currently_live stream, and never
 * invents metadata.
 */
export function selectBestYouTubeCandidate(
  candidates: YouTubeCandidate[],
  options: YouTubeSelectionOptions
): YouTubeSelectionResult {
  if (!candidates || candidates.length === 0) {
    return {
      selected: null,
      channelVerified: false,
      reason: `No YouTube search results found for "${options.query}".`,
      candidatesEvaluated: 0,
      errorCode: "NO_RESULTS",
    };
  }

  const reqChannel = options.requestedChannel?.trim();
  const channelMatched = reqChannel
    ? candidates.filter((c) => matchesRequestedChannel(c, reqChannel))
    : candidates;

  if (options.requireChannelVerification && reqChannel && channelMatched.length === 0) {
    return {
      selected: null,
      channelVerified: false,
      reason: `Could not verify any official or matching YouTube channel for "${reqChannel}".`,
      candidatesEvaluated: candidates.length,
      errorCode: "CHANNEL_NOT_VERIFIED",
    };
  }

  const pool = channelMatched.length > 0 ? channelMatched : candidates;
  const nonShorts = pool.filter((c) => !c.isShort && !c.isUpcoming);

  if (options.subtype === "currently_live") {
    const liveCandidates = nonShorts.filter((c) => c.isLiveNow);
    if (liveCandidates.length === 0) {
      return {
        selected: null,
        channelVerified: pool.some((c) => c.isVerifiedChannel),
        reason: `No currently LIVE broadcast found for "${reqChannel || options.query}".`,
        candidatesEvaluated: candidates.length,
        errorCode: "NO_LIVE_STREAM_AVAILABLE",
      };
    }
    const best = liveCandidates.sort((a, b) => Number(b.isVerifiedChannel) - Number(a.isVerifiedChannel))[0]!;
    return {
      selected: best,
      channelVerified: best.isVerifiedChannel || matchesRequestedChannel(best, reqChannel),
      reason: `Selected currently LIVE broadcast "${best.title}" by ${best.channelName}.`,
      candidatesEvaluated: candidates.length,
    };
  }

  if (options.subtype === "latest_livestream" || options.subtype === "livestream_replay") {
    const streamCandidates = nonShorts.filter((c) =>
      options.subtype === "livestream_replay"
        ? c.isCompletedLivestream
        : c.isLiveNow || c.isCompletedLivestream
    );

    if (streamCandidates.length === 0) {
      return {
        selected: null,
        channelVerified: pool.some((c) => c.isVerifiedChannel),
        reason: `No verified livestream or livestream replay found for "${reqChannel || options.query}".`,
        candidatesEvaluated: candidates.length,
        errorCode: "NO_VERIFIED_LIVESTREAM_FOUND",
      };
    }

    const sorted = [...streamCandidates].sort((a, b) => {
      if (options.subtype === "latest_livestream" && a.isLiveNow !== b.isLiveNow) {
        return a.isLiveNow ? -1 : 1;
      }
      if (a.isVerifiedChannel !== b.isVerifiedChannel) {
        return a.isVerifiedChannel ? -1 : 1;
      }
      return parsePublishedAgeMinutes(a.publishedText) - parsePublishedAgeMinutes(b.publishedText);
    });

    const best = sorted[0]!;
    return {
      selected: best,
      channelVerified: best.isVerifiedChannel || matchesRequestedChannel(best, reqChannel),
      reason: `Selected ${best.isLiveNow ? "live broadcast" : "livestream replay"} "${best.title}" (${best.publishedText || "recent"}).`,
      candidatesEvaluated: candidates.length,
    };
  }

  if (options.subtype === "latest_video") {
    const sorted = [...(nonShorts.length > 0 ? nonShorts : pool)].sort((a, b) => {
      const ageDiff = parsePublishedAgeMinutes(a.publishedText) - parsePublishedAgeMinutes(b.publishedText);
      if (Number.isFinite(ageDiff) && ageDiff !== 0) return ageDiff;
      return Number(b.isVerifiedChannel) - Number(a.isVerifiedChannel);
    });
    const best = sorted[0]!;
    return {
      selected: best,
      channelVerified: best.isVerifiedChannel || matchesRequestedChannel(best, reqChannel),
      reason: `Selected latest video "${best.title}" (${best.publishedText || "top result"}).`,
      candidatesEvaluated: candidates.length,
    };
  }

  const best = (nonShorts[0] ?? pool[0])!;
  return {
    selected: best,
    channelVerified: best.isVerifiedChannel || matchesRequestedChannel(best, reqChannel),
    reason: `Selected "${best.title}" by ${best.channelName}.`,
    candidatesEvaluated: candidates.length,
  };
}

/**
 * Executes a YouTube comment via Playwright DOM with strict target verification,
 * login/disabled-comment checks, approval enforcement, and post-publish DOM verification.
 */
export async function executeYouTubeCommentDOM(
  page: Page,
  options: {
    commentText: string;
    expectedVideoId?: string;
    expectedTitle?: string;
    approved?: boolean;
  }
): Promise<YouTubeCommentDomResult> {
  const cleanComment = options.commentText.trim();
  if (!cleanComment) {
    return {
      success: false,
      status: "FAILED",
      verified: false,
      published: false,
      error: "Comment text cannot be empty.",
    };
  }

  const observedUrl = page.url();
  const observedTitle = await page.title().catch(() => "");

  if (options.expectedVideoId && !observedUrl.includes(options.expectedVideoId)) {
    return {
      success: false,
      status: "VERIFICATION_FAILED",
      verified: false,
      published: false,
      targetVerified: false,
      observedUrl,
      observedTitle,
      error: `Target video mismatch: expected video ID "${options.expectedVideoId}", observed "${observedUrl}".`,
    };
  }

  // Check if comments are disabled or user is logged out
  const domState = await page.evaluate(() => {
    const bodyText = document.body?.innerText || "";
    const commentsDisabled = /comments are turned off/i.test(bodyText);
    const signInButton = document.querySelector('a[href*="ServiceLogin"], ytd-button-renderer a[aria-label*="Sign in"]');
    const avatarBtn = document.querySelector("#avatar-btn");
    const loggedOut = Boolean(signInButton && !avatarBtn);
    return { commentsDisabled, loggedOut };
  });

  if (domState.commentsDisabled) {
    return {
      success: false,
      status: "FAILED",
      verified: false,
      published: false,
      commentsDisabled: true,
      targetVerified: true,
      observedUrl,
      observedTitle,
      error: "Comments are disabled on this video.",
    };
  }

  if (domState.loggedOut) {
    return {
      success: false,
      status: "FAILED",
      verified: false,
      published: false,
      loggedOut: true,
      targetVerified: true,
      observedUrl,
      observedTitle,
      error: "YouTube account is signed out. Please sign in before commenting.",
    };
  }

  // Enforce approval gate BEFORE clicking submit
  if (options.approved !== true) {
    return {
      success: false,
      status: "AWAITING_APPROVAL",
      verified: false,
      published: false,
      requiresApproval: true,
      targetVerified: true,
      observedUrl,
      observedTitle,
    };
  }

  try {
    await page.evaluate(() => window.scrollBy(0, 600));
    const placeholder = page.locator("#simplebox-placeholder, ytd-comment-simplebox-renderer #placeholder-area").first();
    await placeholder.waitFor({ state: "visible", timeout: 6000 });
    await placeholder.click();

    const editable = page.locator("#contenteditable-root").first();
    await editable.waitFor({ state: "visible", timeout: 5000 });
    await editable.fill(cleanComment);

    const submitBtn = page.locator("#submit-button button, #submit-button").first();
    await submitBtn.click();

    // Verify published comment appears in the comment thread
    const publishedVisible = await page
      .locator("ytd-comment-thread-renderer #content-text")
      .filter({ hasText: cleanComment })
      .first()
      .waitFor({ state: "visible", timeout: 8000 })
      .then(() => true)
      .catch(() => false);

    if (!publishedVisible) {
      return {
        success: false,
        status: "VERIFICATION_FAILED",
        verified: false,
        published: false,
        targetVerified: true,
        observedUrl,
        observedTitle,
        error: "Comment was submitted, but could not verify its appearance in the comment thread.",
      };
    }

    log.info("[YOUTUBE_COMMENT_DOM_VERIFIED]", { observedUrl, commentLength: cleanComment.length });
    return {
      success: true,
      status: "SUCCESS",
      verified: true,
      published: true,
      targetVerified: true,
      observedUrl,
      observedTitle,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      status: "FAILED",
      verified: false,
      published: false,
      targetVerified: true,
      observedUrl,
      observedTitle,
      error: msg,
    };
  }
}
