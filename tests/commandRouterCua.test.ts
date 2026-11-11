import { describe, it, expect } from "bun:test";
import { routeFastCommand } from "../src/graph/commandRouter";
import { classifyRuntimeMode } from "../src/runtime/RuntimeModeClassifier";

describe("CUA Fast Command & Runtime Routing", () => {
  it("routes 'what is currently open on my screen?' to active_window fast command", () => {
    const cmd = routeFastCommand("what is currently open on my screen?");
    expect(cmd).not.toBeNull();
    expect(cmd?.kind).toBe("active_window");

    const mode = classifyRuntimeMode("what is currently open on my screen?");
    expect(mode.mode).toBe("execution");
    expect(mode.targetAgent).toBe("laptopAgent");
  });

  it("routes Hindi/Hinglish screen questions", () => {
    const cmd1 = routeFastCommand("screen pe kya chal raha hai");
    expect(cmd1?.kind).toBe("active_window");

    const cmd2 = routeFastCommand("inspect active window");
    expect(cmd2?.kind).toBe("active_window");

    const cmd3 = routeFastCommand("what's on my screen?");
    expect(cmd3?.kind).toBe("active_window");
  });

  it("routes CUA click and type commands", () => {
    const clickCmd = routeFastCommand("click at 400 300");
    expect(clickCmd?.kind).toBe("cua_click");
    if (clickCmd?.kind === "cua_click") {
      expect(clickCmd.x).toBe(400);
      expect(clickCmd.y).toBe(300);
    }

    const typeCmd = routeFastCommand("type Hello Rachit into notepad");
    expect(typeCmd?.kind).toBe("cua_type");
    if (typeCmd?.kind === "cua_type") {
      expect(typeCmd.text).toBe("Hello Rachit");
      expect(typeCmd.targetApp).toBe("notepad");
    }
  });

  it("routes MCP server list commands", () => {
    const mcpCmd = routeFastCommand("list all mcp servers");
    expect(mcpCmd?.kind).toBe("mcp_list");
  });
});

