import { describe, expect, it } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { routeFastCommand, parseYouTubeCommand } from "../src/graph/commandRouter.js";
import {
  decomposeTask,
  validateExecutionPlan,
  computePlanOverallStatus,
  formatPlanExecutionSummary,
  normalizeYouTubeSearchQuery,
  detectLanguageAndScript,
} from "../src/orchestration/universalPlan.js";
import {
  parseYouTubeCandidatesFromInitialData,
  selectBestYouTubeCandidate,
  executeYouTubeCommentDOM,
  type YouTubeCandidate,
} from "../src/tools/laptop/youtubeIntelligence.js";
import {
  setPendingActionApproval,
  getPendingActionApproval,
  clearPendingActionApproval,
  isExplicitApproval,
  isExplicitRejection,
  isExplicitCancellation,
  extractApprovalModification,
  revalidatePendingApproval,
} from "../src/conversation/pendingIntentStore.js";
import {
  setActiveTarget,
  getTaskContext,
  clearTaskContext,
} from "../src/conversation/taskContextStore.js";
import { verifierAgent } from "../src/agents/verifierAgent.js";
import { plannerAgent } from "../src/agents/plannerAgent.js";
import { verifySavedDesktopFile } from "../src/tools/laptop/desktopControl.js";
import { parseStructuredWebGoal } from "../src/mcp/browser/universalWebOperator.js";

describe("Global Agent Intelligence & YouTube Reliability Upgrade", () => {
  // ── A. YouTube Intent Understanding & Query Normalization ──────────────────
  describe("A. YouTube Intent Understanding & Query Normalization", () => {
    it("1. Play latest CarryMinati video", () => {
      const cmd = routeFastCommand("Play latest CarryMinati video.");
      expect(cmd?.kind).toBe("youtube");
      if (cmd?.kind === "youtube") {
        expect(cmd.action).toBe("play");
        expect(cmd.query?.toLowerCase()).toContain("carryminati");
        expect(cmd.query?.toLowerCase()).not.toContain("play");
      }
      const plan = decomposeTask("Play latest CarryMinati video.");
      expect(plan.actions[0]?.params.mediaSubtype).toBe("latest_video");
    });

    it("2. Play latest CarryMinati livestream (including without literal 'youtube' word)", () => {
      const cmd1 = parseYouTubeCommand("open latest livestreaming of carryminati now");
      expect(cmd1).not.toBeNull();
      expect(cmd1?.action).toBe("play");
      expect(cmd1?.mediaSubtype).toBe("latest_livestream");
      expect(cmd1?.query).toBe("carryminati livestream");

      const cmd2 = parseYouTubeCommand("Play latest CarryMinati livestream.");
      expect(cmd2?.action).toBe("play");
      expect(cmd2?.mediaSubtype).toBe("latest_livestream");
      expect(cmd2?.query).toBe("CarryMinati livestream");
    });

    it("3. Play currently live CarryMinati stream", () => {
      const cmd = parseYouTubeCommand("Play currently live CarryMinati stream.");
      expect(cmd?.action).toBe("play");
      expect(cmd?.mediaSubtype).toBe("currently_live");
      expect(cmd?.query).toBe("CarryMinati live");
    });

    it("4. Play latest completed CarryMinati livestream replay", () => {
      const cmd = parseYouTubeCommand("Play latest completed CarryMinati livestream replay.");
      expect(cmd?.action).toBe("play");
      expect(cmd?.mediaSubtype).toBe("livestream_replay");
      expect(cmd?.query).toBe("CarryMinati livestream");
    });

    it("5. Standalone comment command is NOT misclassified as playback", () => {
      const cmdA = parseYouTubeCommand("Comment Carry bhai big fan on this video.");
      expect(cmdA?.action).toBe("comment");
      expect(cmdA?.comment).toBe("Carry bhai big fan");
      expect(cmdA?.commentOnly).toBe(true);

      const cmdB = parseYouTubeCommand(
        "now comment on latest livestreaming of carryminati now on youtube that carry bhai big fan"
      );
      expect(cmdB?.action).toBe("comment");
      expect(cmdB?.comment).toBe("carry bhai big fan");
      expect(cmdB?.query).toBe("carryminati livestream");
    });

    it("6. Multi-action: Play latest livestream and comment big fan", () => {
      const cmd = parseYouTubeCommand("Play latest livestream and comment big fan.");
      expect(cmd?.action).toBe("play");
      expect(cmd?.mediaSubtype).toBe("latest_livestream");
      expect(cmd?.comment).toBe("big fan");
    });

    it("7. Multi-action: Play latest video and subscribe to the channel", () => {
      const cmd = parseYouTubeCommand("Play latest video and subscribe to the channel.");
      expect(cmd?.action).toBe("play");
      expect(cmd?.subscribe).toBe(true);
      const plan = decomposeTask("Play latest video and subscribe to the channel.");
      expect(plan.actions[0]?.params.mediaSubtype).toBe("latest_video");
      expect(plan.actions[1]?.type).toBe("youtube.subscribe");
    });

    it("8. Negated comment: Play the video but don't comment", () => {
      const cmd = parseYouTubeCommand("Play the video on youtube but don't comment.");
      expect(cmd?.action).toBe("play");
      expect(cmd?.comment).toBeUndefined();
    });

    it("9. Search query normalization strips action verbs and filler", () => {
      const q = normalizeYouTubeSearchQuery(
        "play latest livestream of carryminati and comment big fan bro",
        "latest_livestream"
      );
      expect(q.toLowerCase()).not.toContain("play");
      expect(q.toLowerCase()).not.toContain("comment");
      expect(q.toLowerCase()).toContain("carryminati");
      expect(q.toLowerCase()).toContain("livestream");
    });
  });

  // ── B. YouTube Candidate Selection & Edge Cases ───────────────────────────
  describe("B. YouTube Candidate Selection & Verification Rules", () => {
    const sampleCandidates: YouTubeCandidate[] = [
      {
        videoId: "gta12345678",
        url: "https://www.youtube.com/watch?v=gta12345678",
        title: "BACK AT IT AGAIN IN THE VICE CITY!!!! | NO PROMOTIONS",
        channelName: "CarryIsLive",
        isVerifiedChannel: true,
        isLiveNow: false,
        isCompletedLivestream: false,
        isUpcoming: false,
        isShort: false,
        publishedText: "1 day ago",
        badges: [],
      },
      {
        videoId: "stream98765",
        url: "https://www.youtube.com/watch?v=stream98765",
        title: "BGMI LATE NIGHT STREAM | CarryIsLive",
        channelName: "CarryIsLive",
        isVerifiedChannel: true,
        isLiveNow: false,
        isCompletedLivestream: true,
        isUpcoming: false,
        isShort: false,
        publishedText: "Streamed 5 hours ago",
        badges: [],
      },
      {
        videoId: "short111111",
        url: "https://www.youtube.com/shorts/short111111",
        title: "CarryMinati funny clip #shorts",
        channelName: "CarryMinati",
        isVerifiedChannel: true,
        isLiveNow: false,
        isCompletedLivestream: false,
        isUpcoming: false,
        isShort: true,
        publishedText: "1 hour ago",
        badges: [],
      },
    ];

    it("9. Distinguishes regular videos and Shorts from livestream recordings", () => {
      const result = selectBestYouTubeCandidate(sampleCandidates, {
        query: "CarryMinati livestream",
        requestedChannel: "CarryMinati",
        subtype: "latest_livestream",
      });
      expect(result.selected?.videoId).toBe("stream98765");
      expect(result.channelVerified).toBe(true);
    });

    it("10. No currently LIVE broadcast available -> never substitutes old recording", () => {
      const result = selectBestYouTubeCandidate(sampleCandidates, {
        query: "CarryMinati live",
        requestedChannel: "CarryMinati",
        subtype: "currently_live",
      });
      expect(result.selected).toBeNull();
      expect(result.errorCode).toBe("NO_LIVE_STREAM_AVAILABLE");
    });

    it("11. Official channel cannot be verified when requireChannelVerification is true", () => {
      const result = selectBestYouTubeCandidate(sampleCandidates, {
        query: "UnknownCreator livestream",
        requestedChannel: "UnknownCreator",
        subtype: "latest_livestream",
        requireChannelVerification: true,
      });
      expect(result.selected).toBeNull();
      expect(result.errorCode).toBe("CHANNEL_NOT_VERIFIED");
    });

    it("parses ytInitialData live & streamed badges accurately", () => {
      const fakeInitialData = {
        contents: {
          twoColumnSearchResultsRenderer: {
            primaryContents: {
              sectionListRenderer: {
                contents: [
                  {
                    itemSectionRenderer: {
                      contents: [
                        {
                          videoRenderer: {
                            videoId: "live0000001",
                            title: { runs: [{ text: "LIVE NOW: CarryIsLive" }] },
                            ownerText: { runs: [{ text: "CarryIsLive" }] },
                            ownerBadges: [{ metadataBadgeRenderer: { style: "BADGE_STYLE_TYPE_VERIFIED" } }],
                            badges: [{ metadataBadgeRenderer: { label: "LIVE", style: "BADGE_STYLE_TYPE_LIVE_NOW" } }],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
            },
          },
        },
      };
      const parsed = parseYouTubeCandidatesFromInitialData(fakeInitialData);
      expect(parsed.length).toBe(1);
      expect(parsed[0]?.isLiveNow).toBe(true);
      expect(parsed[0]?.isVerifiedChannel).toBe(true);
    });
  });

  // ── C. YouTube Comment DOM Execution (Logged Out, Disabled, Approval) ─────
  describe("C. YouTube Comment DOM Execution & Failure States", () => {
    const makeMockPage = (opts: { url: string; bodyText: string; loggedOut?: boolean }) =>
      ({
        url: () => opts.url,
        title: async () => "CarryIsLive Stream - YouTube",
        evaluate: async () => ({
          commentsDisabled: /comments are turned off/i.test(opts.bodyText),
          loggedOut: Boolean(opts.loggedOut),
        }),
      }) as unknown as import("playwright").Page;

    it("12. YouTube is logged out -> returns FAILED with loggedOut=true", async () => {
      const page = makeMockPage({
        url: "https://www.youtube.com/watch?v=stream98765",
        bodyText: "Sign in",
        loggedOut: true,
      });
      const res = await executeYouTubeCommentDOM(page, {
        commentText: "Carry bhai, big fan bro!",
        expectedVideoId: "stream98765",
        approved: true,
      });
      expect(res.success).toBe(false);
      expect(res.loggedOut).toBe(true);
    });

    it("13. Comments are disabled -> returns FAILED with commentsDisabled=true", async () => {
      const page = makeMockPage({
        url: "https://www.youtube.com/watch?v=stream98765",
        bodyText: "Comments are turned off. Learn more",
      });
      const res = await executeYouTubeCommentDOM(page, {
        commentText: "Carry bhai, big fan bro!",
        expectedVideoId: "stream98765",
        approved: true,
      });
      expect(res.success).toBe(false);
      expect(res.commentsDisabled).toBe(true);
    });

    it("14. Target video mismatch -> returns VERIFICATION_FAILED", async () => {
      const page = makeMockPage({
        url: "https://www.youtube.com/watch?v=wrongvideo1",
        bodyText: "Add a comment",
      });
      const res = await executeYouTubeCommentDOM(page, {
        commentText: "Carry bhai, big fan bro!",
        expectedVideoId: "stream98765",
        approved: true,
      });
      expect(res.success).toBe(false);
      expect(res.status).toBe("VERIFICATION_FAILED");
      expect(res.targetVerified).toBe(false);
    });

    it("15. Approval gate -> returns AWAITING_APPROVAL when approved !== true", async () => {
      const page = makeMockPage({
        url: "https://www.youtube.com/watch?v=stream98765",
        bodyText: "Add a comment",
      });
      const res = await executeYouTubeCommentDOM(page, {
        commentText: "Carry bhai, big fan bro!",
        expectedVideoId: "stream98765",
      });
      expect(res.success).toBe(false);
      expect(res.status).toBe("AWAITING_APPROVAL");
      expect(res.requiresApproval).toBe(true);
    });
  });

  // ── D. Multi-Action Task Decomposition & Acceptance Scenario ──────────────
  describe("D. Multi-Action Task Decomposition & E2E Acceptance Plan", () => {
    it("E2E Acceptance Plan: Play CarryMinati's latest livestream and comment 'Carry bhai, big fan bro!'", () => {
      const plan = decomposeTask(
        "Play CarryMinati's latest livestream on YouTube and comment 'Carry bhai, big fan bro!'"
      );
      const validation = validateExecutionPlan(plan);
      expect(validation.valid).toBe(true);
      expect(plan.actions.length).toBe(2);

      const [playStep, commentStep] = plan.actions;
      expect(playStep?.type).toBe("youtube.select_and_play");
      expect(playStep?.params.mediaSubtype).toBe("latest_livestream");
      expect(playStep?.params.query).toBe("CarryMinati livestream");

      expect(commentStep?.type).toBe("youtube.comment");
      expect(commentStep?.params.commentText).toBe("Carry bhai, big fan bro!");
      expect(commentStep?.dependsOn).toContain(playStep?.id);
      expect(commentStep?.targetFromStep).toBe(playStep?.id);
      expect(commentStep?.requiresApproval).toBe(true);
      expect(commentStep?.idempotent).toBe(false);
    });

    it("5-action global workflow: Open browser, find AI news, summarize, save document, and open it", () => {
      const plan = decomposeTask(
        "Open my browser, find the latest AI news, summarize the three most important articles, save the summary in a document, and open that document."
      );
      const validation = validateExecutionPlan(plan);
      expect(validation.valid).toBe(true);
      expect(plan.actions.length).toBe(5);
      expect(plan.actions.map((a) => a.type)).toEqual([
        "browser.open",
        "browser.search",
        "content.summarize",
        "fs.write_document",
        "system.open_path",
      ]);
      // Dependency chain preserved
      expect(plan.actions[1]?.dependsOn).toContain("action_1");
      expect(plan.actions[2]?.dependsOn).toContain("action_2");
      expect(plan.actions[3]?.dependsOn).toContain("action_3");
      expect(plan.actions[4]?.dependsOn).toContain("action_4");
      expect(plan.actions[4]?.targetFromStep).toBe("action_4");
    });

    it("Commerce multi-action workflow with purchase approval gate", () => {
      const plan = decomposeTask(
        "Find a suitable mechanical keyboard, compare its price, add it to my cart, and checkout"
      );
      expect(plan.actions.map((a) => a.type)).toEqual([
        "browser.search",
        "web.compare_prices",
        "commerce.add_to_cart",
        "commerce.purchase",
      ]);
      expect(plan.actions[3]?.requiresApproval).toBe(true);
    });

    it("Preserves Roman Hinglish script without turning into Devanagari", () => {
      const lang = detectLanguageAndScript("CarryMinati ki latest livestream chala aur comment kar");
      expect(lang.language).toBe("hinglish");
      expect(lang.script).toBe("roman");

      const dev = detectLanguageAndScript("यूट्यूब पर वीडियो चलाओ");
      expect(dev.language).toBe("hindi");
      expect(dev.script).toBe("devanagari");
    });

    it("plannerAgent populates universalPlan alongside steps", async () => {
      const res = await plannerAgent({
        requestId: "test-plan-1",
        executionMode: "multi-agent",
        userGoal: "Open my browser, find latest AI news, summarize it, save in a document, and open it",
      });
      expect(res.result.universalPlan).toBeDefined();
      expect(res.result.universalPlan?.actions.length).toBe(5);
    });
  });

  // ── E. Partial Completion, Verification & False-Success Prevention ────────
  describe("E. Verification & Partial Execution Reporting", () => {
    it("15. Playback succeeds but comment awaits approval -> reports partially_completed", () => {
      const plan = decomposeTask("Play CarryMinati's latest livestream and comment 'Carry bhai, big fan bro!'");
      plan.actions[0]!.status = "completed";
      plan.actions[0]!.evidence = {
        verified: true,
        status: "VERIFIED",
        method: "youtube_playback_verified",
        observed: "Playing CarryIsLive stream",
        reason: "Playback verified",
        timestamp: Date.now(),
      };
      plan.actions[1]!.status = "awaiting_approval";

      expect(computePlanOverallStatus(plan.actions)).toBe("partially_completed");
      const summary = formatPlanExecutionSummary(plan);
      expect(summary).toContain("Partially completed");
      expect(summary).toContain("Awaiting user approval");
    });

    it("16. Playback verification fails -> reports verification_failed", () => {
      const plan = decomposeTask("Play latest CarryMinati video");
      plan.actions[0]!.status = "verification_failed";
      plan.actions[0]!.evidence = {
        verified: false,
        status: "NOT_VERIFIED",
        method: "youtube_playback_verified",
        reason: "Player did not start",
        timestamp: Date.now(),
      };
      expect(computePlanOverallStatus(plan.actions)).toBe("verification_failed");
      expect(formatPlanExecutionSummary(plan)).toContain("verification failed");
    });

    it("verifierAgent flags unverified or failed outputs instead of blindly returning success", async () => {
      const res = await verifierAgent({
        requestId: "v-test-1",
        executionMode: "multi-agent",
        executionAgentOutput: {
          success: false,
          stepsExecuted: ["step 1", "step 2"],
          outputs: [
            { step: "step 1", status: "success", verified: true },
            { step: "step 2", status: "error", verified: false, error: "Timeout" },
          ],
        },
      } as unknown as import("../src/orchestration/agentSharedContext.js").AgentSharedContext);
      expect(res.result.success).toBe(false);
      expect(res.result.verified).toBe(false);
      expect(res.result.issues).toContain("Timeout");
    });
  });

  // ── F. Approval Lifecycle, Modification & Session Continuity ──────────────
  describe("F. Approval Lifecycle & Session Context Isolation", () => {
    it("17. Supports approval, rejection, cancellation, modification, and target revalidation", () => {
      clearPendingActionApproval("test-ch");
      setPendingActionApproval("test-ch", {
        intent: "ACTION_APPROVAL",
        actionType: "youtube.comment",
        platform: "youtube",
        target: "https://www.youtube.com/watch?v=stream98765",
        targetUrl: "https://www.youtube.com/watch?v=stream98765",
        targetTitle: "BGMI LATE NIGHT STREAM",
        params: { commentText: "Carry bhai big fan" },
        approvalState: "pending",
        expiresAt: Date.now() + 60000,
        createdAt: Date.now(),
      });

      expect(isExplicitApproval("yes")).toBe(true);
      expect(isExplicitRejection("no")).toBe(true);
      expect(isExplicitCancellation("cancel")).toBe(true);
      expect(extractApprovalModification('change comment to "Carry bhai OP!"')).toBe("Carry bhai OP!");

      const pending = getPendingActionApproval("test-ch");
      expect(pending?.intent).toBe("ACTION_APPROVAL");
      if (pending) {
        const mismatch = revalidatePendingApproval(pending, "https://www.youtube.com/watch?v=other123");
        expect(mismatch.valid).toBe(false);
        expect(mismatch.state).toBe("modified");
      }
      clearPendingActionApproval("test-ch");
    });

    it("Maintains isolated active target context per channel:session", () => {
      clearTaskContext("tui", "sess-a");
      clearTaskContext("tui", "sess-b");

      setActiveTarget(
        "tui",
        {
          targetType: "youtube_video",
          url: "https://www.youtube.com/watch?v=stream98765",
          title: "BGMI LATE NIGHT STREAM",
        },
        "sess-a"
      );

      expect(getTaskContext("tui", "sess-a")?.activeTarget?.title).toBe("BGMI LATE NIGHT STREAM");
      expect(getTaskContext("tui", "sess-b")).toBeUndefined();
    });
  });

  // ── G. Desktop File Verification & Universal Web Operator ─────────────────
  describe("G. Desktop Verification & Universal Web Operator", () => {
    it("verifySavedDesktopFile verifies file existence and content on disk", () => {
      const tmpFile = path.join(os.tmpdir(), `creater_verify_${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, "AI News Summary: 1. Agents", "utf8");
      try {
        const ok = verifySavedDesktopFile(tmpFile, "AI News Summary");
        expect(ok.success).toBe(true);
        expect(ok.verified).toBe(true);

        const mismatch = verifySavedDesktopFile(tmpFile, "Completely different text");
        expect(mismatch.success).toBe(false);
        expect(mismatch.verified).toBe(false);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it("parseStructuredWebGoal parses multi-platform goals cleanly", () => {
      const g1 = parseStructuredWebGoal("open linkedin and send message to ojas -how are you");
      expect(g1.platform).toBe("linkedin");
      expect(g1.intent).toBe("message");
      expect(g1.recipient).toBe("ojas");
      expect(g1.message).toBe("how are you");
    });
  });
});
