import { describe, test, expect } from "bun:test";
import { routeFastCommand } from "../src/graph/commandRouter.js";
import { extractQuery } from "../src/runtime/semantic/queryExtractor.js";
import { processMessageStreaming } from "../src/graph/supervisor.js";

describe("System Controls and Search Suite", () => {
  test("1. Volume commands route to fastCommand kind 'volume'", () => {
    const up = routeFastCommand("volume up");
    expect(up).toEqual({ kind: "volume", raw: "volume up", direction: "up" });

    const up2 = routeFastCommand("increase the volume");
    expect(up2).toEqual({ kind: "volume", raw: "increase the volume", direction: "up" });

    const up3 = routeFastCommand("turn up the volume");
    expect(up3).toEqual({ kind: "volume", raw: "turn up the volume", direction: "up" });

    const up4 = routeFastCommand("volume badhao");
    expect(up4).toEqual({ kind: "volume", raw: "volume badhao", direction: "up" });

    const up5 = routeFastCommand("volume badho");
    expect(up5).toEqual({ kind: "volume", raw: "volume badho", direction: "up" });

    const up6 = routeFastCommand("volume high karo");
    expect(up6).toEqual({ kind: "volume", raw: "volume high karo", direction: "up" });

    const down = routeFastCommand("volume down");
    expect(down).toEqual({ kind: "volume", raw: "volume down", direction: "down" });

    const down2 = routeFastCommand("decrease the volume");
    expect(down2).toEqual({ kind: "volume", raw: "decrease the volume", direction: "down" });

    const down3 = routeFastCommand("turn down the volume");
    expect(down3).toEqual({ kind: "volume", raw: "turn down the volume", direction: "down" });

    const down4 = routeFastCommand("volume kam karo");
    expect(down4).toEqual({ kind: "volume", raw: "volume kam karo", direction: "down" });

    const down5 = routeFastCommand("volume low karo");
    expect(down5).toEqual({ kind: "volume", raw: "volume low karo", direction: "down" });

    const set1 = routeFastCommand("volume ko 70 karo");
    expect(set1).toEqual({ kind: "volume", raw: "volume ko 70 karo", direction: "set", value: 70 });

    const set2 = routeFastCommand("volume 70");
    expect(set2).toEqual({ kind: "volume", raw: "volume 70", direction: "set", value: 70 });

    const set3 = routeFastCommand("set volume to 50%");
    expect(set3).toEqual({ kind: "volume", raw: "set volume to 50%", direction: "set", value: 50 });

    const set4 = routeFastCommand("awaz ko 80 kar do");
    expect(set4).toEqual({ kind: "volume", raw: "awaz ko 80 kar do", direction: "set", value: 80 });

    const mute = routeFastCommand("mute");
    expect(mute).toEqual({ kind: "volume", raw: "mute", direction: "mute" });

    const unmute = routeFastCommand("unmute");
    expect(unmute).toEqual({ kind: "volume", raw: "unmute", direction: "unmute" });
  });

  test("2. Screenshot commands route to fastCommand kind 'screenshot'", () => {
    const ss1 = routeFastCommand("take a screenshot");
    expect(ss1).toEqual({ kind: "screenshot", raw: "take a screenshot" });

    const ss2 = routeFastCommand("screenshot");
    expect(ss2).toEqual({ kind: "screenshot", raw: "screenshot" });

    const ss3 = routeFastCommand("capture screen");
    expect(ss3).toEqual({ kind: "screenshot", raw: "capture screen" });

    const ss4 = routeFastCommand("take screenshot");
    expect(ss4).toEqual({ kind: "screenshot", raw: "take screenshot" });

    const ss5 = routeFastCommand("screenshot lo");
    expect(ss5).toEqual({ kind: "screenshot", raw: "screenshot lo" });

    const ss6 = routeFastCommand("screenshot lelo");
    expect(ss6).toEqual({ kind: "screenshot", raw: "screenshot lelo" });

    const ss7 = routeFastCommand("screenshot khicho");
    expect(ss7).toEqual({ kind: "screenshot", raw: "screenshot khicho" });

    const ss8 = routeFastCommand("screen capture karo");
    expect(ss8).toEqual({ kind: "screenshot", raw: "screen capture karo" });

    const ss9 = routeFastCommand("ss lelo");
    expect(ss9).toEqual({ kind: "screenshot", raw: "ss lelo" });

    const ss10 = routeFastCommand("can you take a screenshot");
    expect(ss10).toEqual({ kind: "screenshot", raw: "can you take a screenshot" });
  });

  test("2b. Native screenshot engine captures desktop screenshot successfully", async () => {
    const { screenshot } = await import("../src/mcp/os/osOps.js");
    const fs = await import("fs");
    const filePath = await screenshot();
    expect(filePath).toBeDefined();
    expect(fs.existsSync(filePath)).toBe(true);
    const stat = fs.statSync(filePath);
    expect(stat.size).toBeGreaterThan(0);
  }, 15000);

  test("3. Search query extractor cleans 'search for' prefix cleanly", () => {
    const q1 = extractQuery("search for elon musk on google");
    expect(q1?.query).toBe("elon musk");

    const q2 = extractQuery("search for quantum computing");
    expect(q2?.query).toBe("quantum computing");

    const q3 = extractQuery("search elon musk on google");
    expect(q3?.query).toBe("elon musk");
  });

  test("4. Volume adjustment executes end-to-end via supervisor without throwing", async () => {
    let output = "";
    const res = await processMessageStreaming("volume up", "web", (tok) => {
      output += tok;
    });

    expect(res).toContain("Volume adjusted (up)");
  }, 15000);

  test("5. adjustVolume hardware control returns real volume levels", async () => {
    const { adjustVolume } = await import("../src/tools/laptop/system.js");
    const resUp = await adjustVolume("up");
    expect(resUp.success).toBe(true);
    expect(resUp.message).toContain("Volume adjusted");

    const resDown = await adjustVolume("down");
    expect(resDown.success).toBe(true);
    expect(resDown.message).toContain("Volume adjusted");
  }, 15000);

  test("6. Exact volume setting ('volume ko 70 karo') executes end-to-end via supervisor", async () => {
    let output = "";
    const res = await processMessageStreaming("volume ko 70 karo", "web", (tok) => {
      output += tok;
    });

    expect(res).toContain("Volume set to 70%");
  }, 15000);
});
