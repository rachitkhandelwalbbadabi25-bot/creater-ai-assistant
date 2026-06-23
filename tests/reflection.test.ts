// tests/reflection.test.ts
import { expect, test, describe, beforeAll } from "bun:test";
import { initDatabase, getDB } from "../src/memory/db";
import { weeklyReflection, monthlyReflection } from "../src/memory/reflection";
import { generateId } from "../src/utils/helpers";

describe("Self Reflection Engine Tests", () => {
  beforeAll(() => {
    initDatabase();
  });

  test("Reflection lists completed goals", () => {
    const db = getDB();
    const taskTitle = `Complete Phase 5 test goal ${generateId().slice(0, 8)}`;

    db.prepare(`
      INSERT INTO tasks (id, title, status, completed_at)
      VALUES (?, ?, 'done', datetime('now'))
    `).run(generateId(), taskTitle);

    const ref = weeklyReflection();
    expect(ref.growth).toContain("User completed");
    expect(ref.completedGoals).toContain(taskTitle);
  });

  test("Reflection returns behavior changes", () => {
    const ref = monthlyReflection();
    expect(ref.behaviorChanges).toBeDefined();
  });
});
