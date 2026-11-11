import { describe, it, expect } from "bun:test";
import { routeFastCommand } from "../src/graph/commandRouter";
import { classifyRuntimeMode } from "../src/runtime/RuntimeModeClassifier";
import { dispatchTool } from "../src/tools/dispatcher";
import { runAutonomousWebTask, inferTargetUrl } from "../src/mcp/browser/universalWebOperator";

describe("Universal Autonomous Web Operator (Manus AI & OpenHuman Architecture)", () => {
  it("infers target URLs dynamically for general web goals", () => {
    expect(inferTargetUrl("open linkedin and message ojas")).toContain("linkedin.com");
    expect(inferTargetUrl("open github and star langchain")).toBe("https://www.github.com/");
    expect(inferTargetUrl("go to amazon and search iphone 16")).toBe("https://www.amazon.com/");
    expect(inferTargetUrl("open reddit and find tech news")).toBe("https://www.reddit.com/");
    expect(inferTargetUrl("go to https://news.ycombinator.com and check top posts")).toBe("https://news.ycombinator.com");
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
    expect((res as any).success).toBe(true);
    expect((res as any).method).toBe("DRY_RUN");
    expect((res as any).summary).toContain("Universal Autonomous Web Operator validated");
  });

  it("dispatches 'social.send_message' via universal autonomous operator", async () => {
    const res = await dispatchTool("social.send_message", {
      platform: "linkedin",
      recipient: "ojas",
      message: "how are you bro",
      dryRun: true,
    });

    expect(res).toBeDefined();
    expect((res as any).success).toBe(true);
    expect((res as any).method).toBe("DRY_RUN");
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
});

