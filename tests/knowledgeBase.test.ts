// tests/knowledgeBase.test.ts
import { expect, test, describe, beforeAll } from "bun:test";
import { initDatabase } from "../src/memory/db";
import { categorizeMemory, searchKnowledge, linkKnowledge, retrieveKnowledgeContext } from "../src/memory/knowledgeBase";

describe("Personal Knowledge Base Tests", () => {
  beforeAll(() => {
    initDatabase();
  });

  test("Categorize memory and search", () => {
    categorizeMemory("Completed BBA-DABI from GLA University", "education", 0.95);

    const results = searchKnowledge("GLA University");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.category).toBe("education");
    expect(results[0]!.value).toBe("Completed BBA-DABI from GLA University");
  });

  test("Link knowledge categories", () => {
    // Links career and education
    linkKnowledge("education", "career", "Education is vital for professional roles", 0.85, 0.9);

    const context = retrieveKnowledgeContext("GLA University");
    expect(context).toContain("Completed BBA-DABI from GLA University");
  });
});
