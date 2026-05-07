// ════════════════════════════════════════════════════════════════════════════════
// src/skills/manager.ts — Load, execute, and manage user-defined skills
// ════════════════════════════════════════════════════════════════════════════════

import { db } from "@memory/db.js";
import { createLogger } from "@utils/logger.js";
import { generateId } from "@utils/helpers.js";

const log = createLogger("skills/manager");

export interface Skill {
  id: string;
  name: string;
  description: string;
  triggerPatterns: string[];
  steps: unknown[];
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

const insertStmt = db.prepare(`
  INSERT INTO skills (id, name, description, trigger_patterns, steps)
  VALUES (?, ?, ?, ?, ?)
`);
const allStmt = db.prepare(`SELECT * FROM skills ORDER BY usage_count DESC`);
const findStmt = db.prepare(`SELECT * FROM skills WHERE name = ?`);
const bumpStmt = db.prepare(`
  UPDATE skills SET usage_count = usage_count + 1, last_used_at = datetime('now') WHERE id = ?
`);

export function registerSkill(
  name: string, description: string,
  triggerPatterns: string[], steps: unknown[]
): Skill {
  const id = generateId();
  insertStmt.run(id, name, description, JSON.stringify(triggerPatterns), JSON.stringify(steps));
  log.info(`Skill registered: ${name}`);
  return { id, name, description, triggerPatterns, steps, usageCount: 0, lastUsedAt: null, createdAt: "" };
}

export function getAllSkills(): Skill[] {
  const rows = allStmt.all() as Array<Record<string, unknown>>;
  return rows.map(r => ({
    id: r.id as string,
    name: r.name as string,
    description: (r.description as string) ?? "",
    triggerPatterns: JSON.parse((r.trigger_patterns as string) || "[]") as string[],
    steps: JSON.parse((r.steps as string) || "[]") as unknown[],
    usageCount: r.usage_count as number,
    lastUsedAt: (r.last_used_at as string) ?? null,
    createdAt: r.created_at as string,
  }));
}

export function findSkillByTrigger(userMessage: string): Skill | null {
  const lower = userMessage.toLowerCase();
  const skills = getAllSkills();
  for (const skill of skills) {
    for (const pattern of skill.triggerPatterns) {
      if (lower.includes(pattern.toLowerCase())) {
        bumpStmt.run(skill.id);
        return skill;
      }
    }
  }
  return null;
}

export function getSkillByName(name: string): Skill | null {
  const row = findStmt.get(name) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? "",
    triggerPatterns: JSON.parse((row.trigger_patterns as string) || "[]") as string[],
    steps: JSON.parse((row.steps as string) || "[]") as unknown[],
    usageCount: row.usage_count as number,
    lastUsedAt: (row.last_used_at as string) ?? null,
    createdAt: row.created_at as string,
  };
}
