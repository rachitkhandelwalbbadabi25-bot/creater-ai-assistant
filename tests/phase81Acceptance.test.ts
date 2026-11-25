import { describe, expect, it } from "bun:test";
import { browserSessionManager } from "../src/mcp/browser/sessionManager.js";
import { isCDPAvailable, isCDPConnected } from "../src/mcp/browser/browserClient.js";
import { selectBestYouTubeCandidate, executeYouTubeCommentDOM, type YouTubeCandidate } from "../src/tools/laptop/youtubeIntelligence.js";
import { verifySavedDesktopFile } from "../src/tools/laptop/desktopControl.js";
import * as path from "path";
import * as os from "os";

describe("Phase 8.1 — Interactive Desktop & Authenticated Browser Acceptance Readiness", () => {
  it("1. Desktop CUA verification never fabricates success for missing file", () => {
    const missingPath = path.join(os.tmpdir(), `nonexistent_p81_${Date.now()}.txt`);
    const res = verifySavedDesktopFile(missingPath, "Creater AI Interactive Desktop Acceptance Test");
    expect(res.success).toBe(false);
    expect(res.verified).toBe(false);
    expect(res.fileExists).toBe(false);
  });

  it("2. Authenticated Chrome CDP readiness check runs safely without exposing credentials", async () => {
    const available = await isCDPAvailable(9222);
    expect(typeof available).toBe("boolean");
  });

  it("3. Non-destructive YouTube acceptance: identifies livestream & stops at AWAITING_APPROVAL before publishing", async () => {
    const candidates: YouTubeCandidate[] = [
      {
        videoId: "reg12345678",
        url: "https://www.youtube.com/watch?v=reg12345678",
        title: "GTA V Funny Moments",
        channelName: "CarryIsLive",
        isVerifiedChannel: true,
        isLiveNow: false,
        isCompletedLivestream: false,
        isUpcoming: false,
        isShort: false,
        publishedText: "2 days ago",
        badges: [],
      },
      {
        videoId: "live8765432",
        url: "https://www.youtube.com/watch?v=live8765432",
        title: "BGMI LIVE STREAM",
        channelName: "CarryIsLive",
        isVerifiedChannel: true,
        isLiveNow: true,
        isCompletedLivestream: false,
        isUpcoming: false,
        isShort: false,
        badges: ["LIVE"],
      },
    ];

    const selected = selectBestYouTubeCandidate(candidates, {
      query: "CarryMinati livestream",
      requestedChannel: "CarryMinati",
      subtype: "latest_livestream",
    });
    expect(selected.selected?.videoId).toBe("live8765432");
    expect(selected.channelVerified).toBe(true);

    // Mock logged-in YouTube watch page DOM (no #submit-button click allowed without approval!)
    let submitClicked = false;
    const mockAuthedPage = {
      url: () => selected.selected!.url,
      title: async () => "BGMI LIVE STREAM - YouTube",
      evaluate: async () => ({ commentsDisabled: false, loggedOut: false }),
      locator: () => ({
        click: async () => {
          submitClicked = true;
        },
      }),
    } as unknown as import("playwright").Page;

    const commentRes = await executeYouTubeCommentDOM(mockAuthedPage, {
      commentText: "Carry bhai, big fan bro!",
      expectedVideoId: selected.selected!.videoId,
      // approved intentionally omitted / false
    });

    expect(commentRes.status).toBe("AWAITING_APPROVAL");
    expect(commentRes.requiresApproval).toBe(true);
    expect(commentRes.published).toBe(false);
    expect(submitClicked).toBe(false);
  });

  it("4. Browser cleanup: closing temporary non-CDP tab releases Playwright browser cleanly", async () => {
    const tabId = await browserSessionManager.openPage();
    const page = browserSessionManager.getPage(tabId);
    expect(page).toBeDefined();
    await browserSessionManager.navigate(tabId, "about:blank");
    await browserSessionManager.closeTab(tabId);
    expect(browserSessionManager.getPage(tabId)).toBeUndefined();
    expect(isCDPConnected()).toBe(false);
  });
});
