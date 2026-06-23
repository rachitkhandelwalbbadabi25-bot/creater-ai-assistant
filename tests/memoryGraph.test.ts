// tests/memoryGraph.test.ts
import { expect, test, describe, beforeAll } from "bun:test";
import { initDatabase } from "../src/memory/db";
import { upsertNode, linkNodes, getNodeWithEdges, findRelatedMemories, expandContext, reinforceRelationship, decayRelationships } from "../src/memory/graph";

describe("Memory Graph Intelligence Tests", () => {
  beforeAll(() => {
    initDatabase();
  });

  test("Node upsert and edge creation", () => {
    const nodeA = upsertNode("person", "Arjun", "Software Engineer", ["colleague"]);
    const nodeB = upsertNode("project", "Creater AI", "AI Assistant", ["living-memory"]);

    expect(nodeA.label).toBe("Arjun");
    expect(nodeB.label).toBe("Creater AI");

    const edge = linkNodes("Arjun", "works_on", "Creater AI", "Assigned main architect role", 0.9);
    expect(edge).not.toBeNull();
    expect(edge!.relation).toBe("works_on");
  });

  test("Multi-hop BFS traversal findRelatedMemories", () => {
    upsertNode("person", "User", "Primary User");
    upsertNode("project", "Creater AI", "AI Assistant");
    upsertNode("tool", "Bun", "JS Runtime");

    linkNodes("User", "works_on", "Creater AI");
    linkNodes("Creater AI", "uses", "Bun");

    // Traversal from User to Bun (2 hops)
    const related = findRelatedMemories("User", 2);
    expect(related.some(r => r.label === "Creater AI")).toBe(true);
    expect(related.some(r => r.label === "Bun")).toBe(true);
  });

  test("Context expansion from query", () => {
    const context = expandContext("Creater AI", 3, 2);
    expect(context).toContain("Creater AI");
  });

  test("Relationship reinforcement and decay", () => {
    linkNodes("User", "uses", "Bun", "Initial link", 0.5);

    reinforceRelationship("User", "uses", "Bun", 0.2);
    const withReinforcement = getNodeWithEdges("User");
    const edgeR = withReinforcement!.edges.find(e => e.target.label === "Bun");
    expect(edgeR!.weight).toBeGreaterThanOrEqual(0.7);

    decayRelationships(0.9);
    const withDecay = getNodeWithEdges("User");
    const edgeD = withDecay!.edges.find(e => e.target.label === "Bun");
    expect(edgeD!.weight).toBeGreaterThanOrEqual(0.63);
  });
});
