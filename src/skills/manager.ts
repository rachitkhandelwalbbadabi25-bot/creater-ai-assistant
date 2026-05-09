// ════════════════════════════════════════════════════════════════════════════════
// src/skills/manager.ts — Load and manage skills stored in Markdown files
// ════════════════════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";
import { createLogger } from "@utils/logger.js";

const log = createLogger("skills/manager");
const STORAGE_DIR = join(process.cwd(), "src/skills/storage");

export interface Skill {
  name: string;
  description: string;
  triggers: string[];
  steps: string[];
  fileName: string;
}

/**
 * Load all skills from the storage directory.
 */
export function loadAllSkills(): Skill[] {
  if (!existsSync(STORAGE_DIR)) return [];

  const files = readdirSync(STORAGE_DIR).filter(f => f.endsWith(".md"));
  const skills: Skill[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(STORAGE_DIR, file), "utf-8");
      const skill = parseSkillMarkdown(content, file);
      if (skill) skills.push(skill);
    } catch (e) {
      log.error(`Failed to load skill file: ${file}`, e);
    }
  }

  return skills;
}

/**
 * Find a skill that matches the user's message.
 */
export function findMatchingSkill(input: string): Skill | null {
  const skills = loadAllSkills();
  const lowerInput = input.toLowerCase();

  for (const skill of skills) {
    for (const trigger of skill.triggers) {
      if (lowerInput.includes(trigger.toLowerCase())) {
        return skill;
      }
    }
  }
  return null;
}

/**
 * Save a new skill to a Markdown file.
 */
export function saveSkill(skill: Omit<Skill, "fileName">): string {
  const fileName = `${skill.name.toLowerCase().replace(/\s+/g, "-")}.md`;
  const content = `---
name: ${skill.name}
description: ${skill.description}
triggers: [${skill.triggers.join(", ")}]
---

# Steps
${skill.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}
`;

  writeFileSync(join(STORAGE_DIR, fileName), content, "utf-8");
  log.info(`Skill saved: ${fileName}`);
  return fileName;
}

/**
 * Helper to parse a skill from Markdown with a YAML-ish header.
 */
function parseSkillMarkdown(content: string, fileName: string): Skill | null {
  const headerMatch = content.match(/^---\n([\s\S]+?)\n---/);
  if (!headerMatch) return null;

  const headerRaw = headerMatch[1]!;
  const name = headerRaw.match(/name:\s*(.+)/)?.[1]?.trim() || "Unknown";
  const description = headerRaw.match(/description:\s*(.+)/)?.[1]?.trim() || "";
  const triggersRaw = headerRaw.match(/triggers:\s*\[(.+)\]/)?.[1] || "";
  const triggers = triggersRaw.split(",").map(t => t.trim()).filter(Boolean);

  const stepsSection = content.split("# Steps")[1] || "";
  const steps = stepsSection
    .split("\n")
    .map(line => line.replace(/^\d+\.\s*/, "").trim())
    .filter(line => line.length > 0);

  return { name, description, triggers, steps, fileName };
}
