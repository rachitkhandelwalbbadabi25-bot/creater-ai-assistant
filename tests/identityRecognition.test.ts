// ════════════════════════════════════════════════════════════════════════════════
// tests/identityRecognition.test.ts — Permanent Identity & Creator Recognition Suite
// ════════════════════════════════════════════════════════════════════════════════

import { describe, test, expect } from "bun:test";
import { CREATER_AI_IDENTITY, buildIdentitySystemPrompt } from "../src/config/identity.js";
import { processMessageStreaming } from "../src/graph/supervisor.js";
import { SYSTEM_PROMPT, OPTIMIZED_SYSTEM_PROMPT } from "../src/llm/prompts.js";

describe("Permanent Identity & Creator Recognition System", () => {
  test("1. Canonical identity object contains authoritative creator and product details", () => {
    expect(CREATER_AI_IDENTITY.name).toBe("Creater AI");
    expect(CREATER_AI_IDENTITY.creator).toBe("Rachit Khandelwal");
    expect(CREATER_AI_IDENTITY.developer).toBe("Rachit Khandelwal");
    expect(CREATER_AI_IDENTITY.category).toBe("Personal Cognitive OS");
    expect(CREATER_AI_IDENTITY.modelProviderNote).toContain("Rachit Khandelwal");
    expect(CREATER_AI_IDENTITY.modelProviderNote).toContain("foundation AI models");
  });

  test("2. Identity prompt builder generates non-empty canonical block with distinctions", () => {
    const prompt = buildIdentitySystemPrompt("qwen2.5:3b");
    expect(prompt).toContain("Rachit Khandelwal");
    expect(prompt).toContain("Personal Cognitive OS");
    expect(prompt).toContain('Current active underlying AI model is: "qwen2.5:3b"');
    expect(prompt).toContain("Never claim that Rachit trained the underlying foundation model");
  });

  test("3. Global SYSTEM_PROMPT & OPTIMIZED_SYSTEM_PROMPT embed canonical identity", () => {
    expect(SYSTEM_PROMPT).toContain("Rachit Khandelwal");
    expect(SYSTEM_PROMPT).toContain("[CANONICAL APPLICATION IDENTITY]");
    expect(OPTIMIZED_SYSTEM_PROMPT).toContain("Rachit Khandelwal");
    expect(OPTIMIZED_SYSTEM_PROMPT).toContain("[CANONICAL APPLICATION IDENTITY]");
  });

  test("4. Q1: 'Who created you?' identifies Rachit Khandelwal", async () => {
    let tokens = "";
    const res = await processMessageStreaming("Who created you?", "tui", (t) => {
      tokens += t;
    });
    expect(res).toContain("Rachit Khandelwal");
  });

  test("5. Q2: 'Who is Rachit?' identifies creator and developer", async () => {
    let tokens = "";
    const res = await processMessageStreaming("Who is Rachit?", "tui", (t) => {
      tokens += t;
    });
    expect(res).toContain("Rachit Khandelwal");
    expect(res).toContain("creator");
  });

  test("6. Q4: 'Are you ChatGPT?' clearly rejects and asserts Creater AI identity", async () => {
    let tokens = "";
    const res = await processMessageStreaming("Are you ChatGPT?", "tui", (t) => {
      tokens += t;
    });
    expect(res).toContain("Creater AI");
    expect(res).toContain("No");
  });

  test("7. Q5: 'What are you being built for?' returns purpose as Personal Cognitive OS", async () => {
    let tokens = "";
    const res = await processMessageStreaming("What are you being built for?", "tui", (t) => {
      tokens += t;
    });
    expect(res).toContain("Personal Cognitive OS");
  });

  test("8. Q6: 'Who is your owner or developer?' returns Rachit Khandelwal", async () => {
    let tokens = "";
    const res = await processMessageStreaming("Who is your owner or developer?", "tui", (t) => {
      tokens += t;
    });
    expect(res).toContain("Rachit Khandelwal");
  });

  test("9. Conversation memory / history cannot overwrite identity constants", () => {
    expect(Object.isFrozen(CREATER_AI_IDENTITY)).toBe(true);
    expect(() => {
      (CREATER_AI_IDENTITY as any).creator = "Another Person";
    }).toThrow();
    expect(CREATER_AI_IDENTITY.creator).toBe("Rachit Khandelwal");
  });

  test("10. Task execution commands continue executing normally without interference", async () => {
    let tokens = "";
    const res = await processMessageStreaming("remind me to read book in 15 minutes", "tui", (t) => {
      tokens += t;
    });
    expect(res).toContain("Reminder set");
  });
});
