import { describe, expect, test } from "bun:test";
import { classifyRuntimeMode } from "../src/runtime/RuntimeModeClassifier.js";
import { processMessage } from "../src/graph/supervisor.js";

describe("Execution Mode Hardening & Bypass Tests", () => {
  test("Classifies fast launch app command with source as alias", () => {
    const classification = classifyRuntimeMode("open notepad");
    expect(classification.mode).toBe("execution");
    expect(classification.executionSource).toBe("alias");
  });

  test("Classifies direct url command with source as direct-launch", () => {
    const classification = classifyRuntimeMode("open google.com");
    expect(classification.mode).toBe("execution");
    expect(classification.executionSource).toBe("direct-launch");
  });

  test("Classifies search command with source as semantic-search", () => {
    const classification = classifyRuntimeMode("search for cute cats on google");
    expect(classification.mode).toBe("execution");
    expect(classification.executionSource).toBe("semantic-search");
  });

  test("Classifies system control commands with source as system-command", () => {
    const classification = classifyRuntimeMode("volume up");
    expect(classification.mode).toBe("execution");
    expect(classification.executionSource).toBe("system-command");
  });

  test("Bypasses conversational fallback and routes execution commands correctly", async () => {
    // A command that classification routes to execution mode will not trigger conversation logic
    const response = await processMessage("open notepad");
    expect(response).toBe("Opening Notepad...");
  });
});
