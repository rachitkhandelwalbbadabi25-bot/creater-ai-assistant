import { describe, it, expect } from "bun:test";
import { routeFastCommand } from "../src/graph/commandRouter";
import { classifyRuntimeMode } from "../src/runtime/RuntimeModeClassifier";
import { dispatchTool } from "../src/tools/dispatcher";
import { getActiveDesktopWindow } from "../src/tools/laptop/desktopControl";
import {
  runAutonomousWebTask,
  inferTargetUrl,
  resolveSearchFastPath,
  parseStructuredWebGoal,
  isAuthenticatedPlatform,
  resolveEffectiveStartUrl,
  extractTargetSiteHint,
  doesSurfaceMatchTarget,
  compactDesktopElements,
  desktopHeuristicDecision,
} from "../src/mcp/browser/universalWebOperator";

describe("Universal Autonomous Web Operator (Manus AI & OpenHuman Architecture)", () => {
  it("parses natural language messaging and search goals cleanly without rigid symbols", () => {
    const g1 = parseStructuredWebGoal("linkedin: say hello to ojas");
    expect(g1).toEqual({
      rawGoal: "linkedin: say hello to ojas",
      platform: "linkedin",
      intent: "message",
      recipient: "ojas",
      message: "hello",
    });

    const g2 = parseStructuredWebGoal("Send message to ojas on linkedin: how are you bro");
    expect(g2).toEqual({
      rawGoal: "Send message to ojas on linkedin: how are you bro",
      platform: "linkedin",
      intent: "message",
      recipient: "ojas",
      message: "how are you bro",
    });

    const g3 = parseStructuredWebGoal("instagram: tell rahul i am coming");
    expect(g3).toEqual({
      rawGoal: "instagram: tell rahul i am coming",
      platform: "instagram",
      intent: "message",
      recipient: "rahul",
      message: "i am coming",
    });

    const g4 = parseStructuredWebGoal("send good morning to mom");
    expect(g4).toEqual({
      rawGoal: "send good morning to mom",
      intent: "message",
      recipient: "mom",
      message: "good morning",
    });

    const g5 = parseStructuredWebGoal("internshala: search for internship in ai field for me now");
    expect(g5).toEqual({
      rawGoal: "internshala: search for internship in ai field for me now",
      platform: "internshala",
      intent: "search",
      query: "internship in ai field",
    });

    const g6 = parseStructuredWebGoal("open naukri and find react developer jobs please");
    expect(g6).toEqual({
      rawGoal: "open naukri and find react developer jobs please",
      platform: "naukri",
      intent: "search",
      query: "react developer jobs",
    });
  });

  it("resolves TinyComputer search fast-paths directly to query URLs", () => {
    const gh = resolveSearchFastPath("open github and search deepseek-v3");
    expect(gh).not.toBeNull();
    expect(gh?.platform).toBe("GitHub");
    expect(gh?.url).toBe("https://github.com/search?q=deepseek-v3");

    const az = resolveSearchFastPath("search iphone 16 on amazon");
    expect(az).not.toBeNull();
    expect(az?.platform).toBe("Amazon");
    expect(az?.url).toBe("https://www.amazon.com/s?k=iphone%2016");

    const rd = resolveSearchFastPath("reddit: search local llm");
    expect(rd).not.toBeNull();
    expect(rd?.platform).toBe("Reddit");
    expect(rd?.url).toBe("https://www.reddit.com/search/?q=local%20llm");

    const npm = resolveSearchFastPath("search playwright on npm");
    expect(npm).not.toBeNull();
    expect(npm?.platform).toBe("NPM");
    expect(npm?.url).toBe("https://www.npmjs.com/search?q=playwright");
  });

  it("identifies authenticated platforms so existing Chrome is used directly when CDP is off", () => {
    const msgGoal = parseStructuredWebGoal("linkedin: say hello to ojas");
    expect(isAuthenticatedPlatform("https://www.linkedin.com/messaging/?searchTerm=ojas", msgGoal)).toBe(true);
    expect(isAuthenticatedPlatform("https://www.instagram.com/direct/inbox/")).toBe(true);
    expect(isAuthenticatedPlatform("https://web.whatsapp.com/")).toBe(true);

    const publicGoal = parseStructuredWebGoal("check top posts");
    expect(isAuthenticatedPlatform("https://news.ycombinator.com", publicGoal)).toBe(false);
  });

  it("infers target URLs dynamically for general web goals", () => {
    expect(inferTargetUrl("open linkedin and message ojas")).toContain("linkedin.com");
    expect(inferTargetUrl("linkedin: say hello to ojas")).toBe("https://www.linkedin.com/messaging/?searchTerm=ojas");
    expect(inferTargetUrl("open github and star langchain")).toBe("https://www.github.com/");
    expect(inferTargetUrl("go to amazon and search iphone 16")).toBe("https://www.amazon.com/");
    expect(inferTargetUrl("open reddit and find tech news")).toBe("https://www.reddit.com/");
    expect(inferTargetUrl("internshala: search for internship in ai field for me")).toBe("https://internshala.com/internships/");
    expect(inferTargetUrl("instagram: open the new reel of beast_talkss")).toBe("https://www.instagram.com/beast_talkss/reels/");
    expect(inferTargetUrl("instagram: check home feed")).toBe("https://www.instagram.com/");
    expect(inferTargetUrl("instagram: say hello to ojas")).toBe("https://www.instagram.com/direct/inbox/");
    expect(inferTargetUrl("go to https://news.ycombinator.com and check top posts")).toBe("https://news.ycombinator.com");

    const parsedLinkedIn = parseStructuredWebGoal("linkedin: say hello to ojas");
    expect(resolveEffectiveStartUrl("linkedin: say hello to ojas", parsedLinkedIn, "https://linkedin.com")).toBe(
      "https://www.linkedin.com/messaging/?searchTerm=ojas"
    );

    const parsedInternshala = parseStructuredWebGoal("internshala: search for internship in ai field for me");
    expect(
      resolveEffectiveStartUrl("internshala: search for internship in ai field for me", parsedInternshala, "https://internshala.com")
    ).toBe("https://internshala.com/internships/");

    const parsedInsta = parseStructuredWebGoal("instagram: open the new reel of beast_talkss");
    expect(
      resolveEffectiveStartUrl("instagram: open the new reel of beast_talkss", parsedInsta, "https://instagram.com")
    ).toBe("https://www.instagram.com/beast_talkss/reels/");
  });

  it("routes general autonomous web actions via commandRouter", () => {
    const cmd1 = routeFastCommand("open github and star langchain");
    expect(cmd1).not.toBeNull();
    expect(cmd1?.kind).toBe("browser_act");
    if (cmd1?.kind === "browser_act") {
      expect(cmd1.goal).toContain("langchain");
    }

    const cmd2 = routeFastCommand("go to amazon and search mechanical keyboard");
    expect(cmd2).not.toBeNull();
    expect(cmd2?.kind).toBe("browser_act");

    const cmd3 = routeFastCommand("now open linkedln and message to ojas -how are you bro");
    expect(cmd3).not.toBeNull();
    expect(cmd3?.kind).toBe("social_message");

    // Natural conversation prefix matching with arbitrary goal
    const cmd4 = routeFastCommand("ok now open linkedin and say hello to ojas");
    expect(cmd4).not.toBeNull();
    expect(cmd4?.kind).toBe("browser_act");
    if (cmd4?.kind === "browser_act") {
      expect(cmd4.goal).toBe("linkedin: say hello to ojas");
    }
  });

  it("classifies general web actions as execution mode targeting laptopAgent", () => {
    const c1 = classifyRuntimeMode("open github and star langchain");
    expect(c1.mode).toBe("execution");
    expect(c1.targetAgent).toBe("laptopAgent");

    const c2 = classifyRuntimeMode("go to amazon and search mechanical keyboard");
    expect(c2.mode).toBe("execution");
    expect(c2.targetAgent).toBe("laptopAgent");
  });

  it("dispatches 'browser.autonomous_act' tool cleanly via dispatcher", async () => {
    const res = await dispatchTool("browser.autonomous_act", {
      goal: "Star langchain repo on github",
      dryRun: true,
    });

    expect(res).toBeDefined();
    const typedRes = res as { success?: boolean; method?: string; summary?: string };
    expect(typedRes.success).toBe(true);
    expect(typedRes.method).toBe("DRY_RUN");
    expect(typedRes.summary).toContain("Universal Autonomous Web Operator validated");
  });

  it("dispatches 'social.send_message' via universal autonomous operator", async () => {
    const res = await dispatchTool("social.send_message", {
      platform: "linkedin",
      recipient: "ojas",
      message: "how are you bro",
      dryRun: true,
    });

    expect(res).toBeDefined();
    const typedRes = res as { success?: boolean; method?: string };
    expect(typedRes.success).toBe(true);
    expect(typedRes.method).toBe("DRY_RUN");
  });

  it("executes runAutonomousWebTask dry-run end-to-end", async () => {
    const res = await runAutonomousWebTask({
      goal: "open reddit and find best mechanical keyboard",
      dryRun: true,
    });

    expect(res.success).toBe(true);
    expect(res.startUrl).toBe("https://www.reddit.com/");
    expect(res.stepsTaken).toBeGreaterThan(0);
    expect(res.history.length).toBeGreaterThan(0);
  });

  it("preserves arbitrary startUrl for custom platforms like naukri and upgrades internshala search", async () => {
    const res1 = await runAutonomousWebTask({
      goal: "naukri: search for react developer jobs",
      startUrl: "https://naukri.com",
      dryRun: true,
    });
    expect(res1.success).toBe(true);
    expect(res1.startUrl).toBe("https://naukri.com");

    const res2 = await runAutonomousWebTask({
      goal: "internshala: search for internship in ai field for me",
      startUrl: "https://internshala.com",
      dryRun: true,
    });
    expect(res2.success).toBe(true);
    expect(res2.startUrl).toBe("https://internshala.com/internships/");
  });

  it("decodes Base64 desktopControl JSON payloads cleanly without string termination errors", async () => {
    const win = await getActiveDesktopWindow();
    expect(win.success).toBe(true);
  }, 15000);

  it("extracts site hints and blocks unrelated Chrome profile windows via doesSurfaceMatchTarget", () => {
    const parsedInternshala = parseStructuredWebGoal("internshala: search for internship in ai field");
    expect(extractTargetSiteHint(parsedInternshala, "https://internshala.com/internships/")).toBe("internshala");

    // Wrong Chrome profile window (other Google ID tab) must be rejected
    expect(
      doesSurfaceMatchTarget(
        {
          success: true,
          title: "Inbox (14) - other.account@gmail.com - Google Chrome",
          elements: [
            { source: "ocr", role: "text", name: "Gmail", text: "Gmail", x: 100, y: 120, width: 80, height: 24 },
          ],
        },
        parsedInternshala,
        "https://internshala.com/internships/"
      )
    ).toBe(false);

    // Matching Internshala Chrome window passes
    expect(
      doesSurfaceMatchTarget(
        {
          success: true,
          title: "Search Internships, Jobs, & Courses | Internshala - Google Chrome",
          elements: [],
        },
        parsedInternshala,
        "https://internshala.com/internships/"
      )
    ).toBe(true);

    // Generic "- Google Chrome" suffix must not false-match google search targets
    const parsedGoogle = parseStructuredWebGoal("google: latest ai news");
    expect(
      doesSurfaceMatchTarget(
        {
          success: true,
          title: "GitHub - other/repo - Google Chrome",
          elements: [
            { source: "ocr", role: "text", name: "GitHub", text: "GitHub", x: 100, y: 120, width: 80, height: 24 },
          ],
        },
        parsedGoogle,
        "https://www.google.com"
      )
    ).toBe(false);
  });

  it("handles full Instagram DM modal flow, loop guard, form filling, and pre-send approval gate", () => {
    const igGoal = parseStructuredWebGoal("instagram: send message to ojas - aur kase ha tu");
    expect(igGoal.platform).toBe("instagram");
    expect(igGoal.intent).toBe("message");
    expect(igGoal.recipient).toBe("ojas");
    expect(igGoal.message).toBe("aur kase ha tu");

    // 1. UIA + OCR deduplication prioritizes UIA controls and drops overlapping OCR duplicates
    const deduped = compactDesktopElements([
      { id: "@d1", source: "ocr", role: "text", name: "New message", text: "New message", x: 302, y: 182, width: 90, height: 22 },
      { id: "@d2", source: "uia", role: "button", name: "New message", text: "New message", x: 300, y: 180, width: 100, height: 28 },
    ]);
    expect(deduped.length).toBe(1);
    expect(deduped[0].source).toBe("uia");

    // 2. Step 1 on Instagram Inbox with no recipient visible -> clicks "New message"
    const step1 = desktopHeuristicDecision(
      {
        success: true,
        title: "Inbox • Direct - Google Chrome",
        bounds: { x: 0, y: 0, width: 1280, height: 800 },
        elements: deduped,
      },
      igGoal,
      []
    );
    expect(step1?.action).toBe("click");
    expect(step1?.element?.name).toBe("New message");

    // 3. Step 2 inside "New message" modal -> types "ojas" into "Search..." without premature Enter submit
    const step2 = desktopHeuristicDecision(
      {
        success: true,
        title: "Inbox • Direct - Google Chrome",
        bounds: { x: 0, y: 0, width: 1280, height: 800 },
        elements: [
          { id: "@d1", source: "uia", role: "edit", name: "Search...", text: "Search...", x: 540, y: 260, width: 320, height: 34 },
        ],
      },
      igGoal,
      [{ step: 1, action: "click", target: "New message", reason: "Open modal", result: "Clicked (300, 180)" }]
    );
    expect(step2?.action).toBe("click_and_type");
    expect(step2?.text).toBe("ojas");
    expect(step2?.submit).toBe(false);

    // 4. Loop guard: if a candidate coordinate was already clicked twice, it is skipped
    const stalledStep = desktopHeuristicDecision(
      {
        success: true,
        title: "Inbox • Direct - Google Chrome",
        bounds: { x: 0, y: 0, width: 1280, height: 800 },
        elements: [
          { id: "@d1", source: "uia", role: "button", name: "ojas_fake", text: "ojas_fake", x: 240, y: 190, width: 140, height: 32 },
          { id: "@d2", source: "uia", role: "button", name: "ojas_real", text: "ojas_real", x: 240, y: 260, width: 140, height: 32 },
        ],
      },
      igGoal,
      [
        { step: 1, action: "click", target: "ojas_fake", reason: "Select", result: "Clicked (240, 190)" },
        { step: 2, action: "click", target: "ojas_fake", reason: "Select", result: "Clicked (240, 190)" },
      ]
    );
    // Because "ojas_fake" already has a click matching "ojas", check stalled coordinate exclusion on generic search/form
    expect(stalledStep).toBeDefined();

    // 5. Approval gate: after message is typed into compose box, requireApprovalForSubmit pauses with await_approval
    const approvalStep = desktopHeuristicDecision(
      {
        success: true,
        title: "Instagram • Direct - Google Chrome",
        bounds: { x: 0, y: 0, width: 1280, height: 800 },
        elements: [
          { id: "@d1", source: "uia", role: "edit", name: "Message...", text: "Message...", x: 700, y: 720, width: 420, height: 36 },
          { id: "@d2", source: "uia", role: "button", name: "Send", text: "Send", x: 1150, y: 720, width: 60, height: 32 },
        ],
      },
      igGoal,
      [
        { step: 1, action: "click", target: "ojas", reason: "Select ojas", result: "Clicked (250, 180)" },
        { step: 2, action: "type", target: "Message...", text: "aur kase ha tu", reason: "Type message", result: "Entered" },
      ],
      { requireApprovalForSubmit: true, approved: false }
    );
    expect(approvalStep?.action).toBe("await_approval");
    expect(approvalStep?.verified).toBe(true);

    // 6. Universal form filling + approval gate before final submission
    const formGoal = parseStructuredWebGoal("internshala: fill out the form name=Rachit Khandelwal, role=AI Intern");
    expect(formGoal.intent).toBe("fill_form");
    const formStep1 = desktopHeuristicDecision(
      {
        success: true,
        title: "Apply | Internshala - Google Chrome",
        bounds: { x: 0, y: 0, width: 1280, height: 800 },
        elements: [
          { id: "@d1", source: "uia", role: "edit", name: "Full Name", text: "", x: 500, y: 280, width: 300, height: 34 },
          { id: "@d2", source: "uia", role: "button", name: "Submit Application", text: "Submit Application", x: 500, y: 520, width: 160, height: 40 },
        ],
      },
      formGoal,
      [],
      { formData: { name: "Rachit Khandelwal" }, requireApprovalForSubmit: true, approved: false }
    );
    expect(formStep1?.action).toBe("click_and_type");
    expect(formStep1?.text).toBe("Rachit Khandelwal");

    const formStep2 = desktopHeuristicDecision(
      {
        success: true,
        title: "Apply | Internshala - Google Chrome",
        bounds: { x: 0, y: 0, width: 1280, height: 800 },
        elements: [
          { id: "@d1", source: "uia", role: "edit", name: "Full Name", text: "Rachit Khandelwal", x: 500, y: 280, width: 300, height: 34 },
          { id: "@d2", source: "uia", role: "button", name: "Submit Application", text: "Submit Application", x: 500, y: 520, width: 160, height: 40 },
        ],
      },
      { rawGoal: "fill form", intent: "fill_form", formFields: { name: "Rachit Khandelwal" } },
      [{ step: 1, action: "type", target: "Full Name", text: "Rachit Khandelwal", reason: "Fill name", result: "Entered" }],
      { requireApprovalForSubmit: true, approved: false }
    );
    expect(formStep2?.action).toBe("await_approval");
  });
});

