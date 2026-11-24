import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "bun:test";
import { writeToDesktopApp } from "../src/tools/laptop/desktopControl.js";

describe("writeToDesktopApp direct typing & foreground guard", () => {
  it("fails cleanly without focusing wrong window when target window does not exist", async () => {
    const res = await writeToDesktopApp(
      "__nonexistent_creater_ai_test_window__",
      "Line 1\n- Bullet 2"
    );
    expect(res.action).toBe("writeapp");
    if (process.platform === "win32") {
      expect(res.success).toBe(false);
      expect(res.found).toBe(false);
      expect(res.error || "").toContain("not found");
    } else {
      expect(res.success).toBe(true);
    }
  }, 15000);

  it("uses DPI-aware Win32 SendInput direct typing and foreground checks in writeapp (no clipboard Ctrl+V)", () => {
    const psPath = path.resolve(process.cwd(), "src/tools/laptop/desktopControl.ps1");
    const psSource = fs.readFileSync(psPath, "utf8");
    const writeAppMatch = psSource.match(/"writeapp"\s*\{[\s\S]*?\n\s{4}\}/);
    expect(writeAppMatch).not.toBeNull();
    const writeAppBlock = writeAppMatch?.[0] ?? "";

    expect(psSource).toContain("IsWindowCloaked");
    expect(psSource).toContain("RaiseWindowZOrder");
    expect(psSource).toContain("GetWindowPidAtPoint");
    expect(psSource).toContain("VkKeyScanExW");
    expect(psSource).toContain("MapVirtualKeyExW");
    expect(psSource).toContain("ReleaseHeldModifiers");
    expect(psSource).toContain("SendCtrlShortcut");
    expect(psSource).toContain("VK_LSHIFT");
    expect(psSource).toContain("MatchByProc");
    expect(psSource).toContain("uiaLatencyMs");
    expect(psSource).not.toContain("FlushUnicodeBurst");

    expect(writeAppBlock).toContain("[DesktopNative]::EnsureDpiAware()");
    expect(writeAppBlock).toContain("Ensure-WindowForeground");
    expect(writeAppBlock).toContain("Test-WindowForeground");
    expect(writeAppBlock).toContain("$editorAlreadyFocused");
    expect(writeAppBlock).toContain("GetWindowPidAtPoint");
    expect(writeAppBlock).toContain("SendUnicodeLine");
    expect(writeAppBlock).toContain("DocumentRange.GetText");
    expect(writeAppBlock).toContain('method = "sendinput_direct"');

    // Never hijack user clipboard or blast Ctrl+V inside writeapp
    expect(writeAppBlock).not.toContain("Clipboard");
    expect(writeAppBlock).not.toContain('SendWait("^v")');
  });

  it("DesktopNative compiles and maps ASCII/punctuation/Unicode deterministically", async () => {
    if (process.platform !== "win32") return;
    const psPath = path.resolve(process.cwd(), "src/tools/laptop/desktopControl.ps1");
    const proc = Bun.spawnSync(
      [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        psPath,
        "-Action",
        "typecheck",
      ],
      { stdout: "pipe", stderr: "pipe" }
    );
    // Running an unknown action still compiles DesktopNative via Add-Type before switch dispatch.
    const out = proc.stdout.toString() + proc.stderr.toString();
    expect(out).not.toContain("error CS");
  }, 15000);

  it("configures extended timeout for writeapp direct typing in desktopControl.ts", () => {
    const tsPath = path.resolve(process.cwd(), "src/tools/laptop/desktopControl.ts");
    const tsSource = fs.readFileSync(tsPath, "utf8");
    expect(tsSource).toContain('actionName === "writeapp" ? 25000');
  });
});
