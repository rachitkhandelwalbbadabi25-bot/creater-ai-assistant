import { describe, it, expect } from "bun:test";
import { routeFastCommand } from "../src/graph/commandRouter";
import { classifyRuntimeMode } from "../src/runtime/RuntimeModeClassifier";

describe("Social Messaging Fast Command & Routing", () => {
  it("routes user's exact command: 'now open linkedln and message to ojas -how are you bro'", () => {
    const cmd = routeFastCommand("now open linkedln and message to ojas -how are you bro");
    expect(cmd).not.toBeNull();
    expect(cmd?.kind).toBe("social_message");
    if (cmd?.kind === "social_message") {
      expect(cmd.platform).toBe("linkedin");
      expect(cmd.recipient).toBe("ojas");
      expect(cmd.message).toBe("how are you bro");
    }

    const mode = classifyRuntimeMode("now open linkedln and message to ojas -how are you bro");
    expect(mode.mode).toBe("execution");
    expect(mode.targetAgent).toBe("laptopAgent");
  });

  it("routes Instagram and other platforms", () => {
    const cmd1 = routeFastCommand("open instagram and message ojas: hello");
    expect(cmd1?.kind).toBe("social_message");
    if (cmd1?.kind === "social_message") {
      expect(cmd1.platform).toBe("instagram");
      expect(cmd1.recipient).toBe("ojas");
      expect(cmd1.message).toBe("hello");
    }

    const cmd2 = routeFastCommand("dm ojas on insta -whats up");
    expect(cmd2?.kind).toBe("social_message");
    if (cmd2?.kind === "social_message") {
      expect(cmd2.platform).toBe("instagram");
      expect(cmd2.recipient).toBe("ojas");
      expect(cmd2.message).toBe("whats up");
    }
  });
});

