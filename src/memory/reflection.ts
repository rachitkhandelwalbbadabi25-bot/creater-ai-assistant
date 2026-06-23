// src/memory/reflection.ts — Self Reflection Engine
import { getDB } from "./db.js";
import { getBehaviorSummary } from "./evolution.js";
import { getTimeline } from "./timeline.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("memory/reflection");

export interface ReflectionSummary {
  growth: string;
  completedGoals: string[];
  projectEvolution: string[];
  behaviorChanges: string;
}

export function generateReflection(days: number): ReflectionSummary {
  const db = getDB();

  // Get completed goals from tasks
  const completedTasks = db.prepare(`
    SELECT title FROM tasks
    WHERE status = 'done'
      AND datetime(completed_at) >= datetime('now', ?)
  `).all(`-${days} days`) as any[];
  const completedGoals = completedTasks.map(t => t.title);

  // Get active projects from timeline
  const projects = getTimeline({ category: "project", limit: 5 });
  const projectEvolution = projects.map(p => `${p.title}: ${p.description ?? ""}`);

  // Fetch behavior changes
  const behaviorChanges = getBehaviorSummary();

  const growth = completedGoals.length > 0
    ? `User completed ${completedGoals.length} key goals in the last ${days} days.`
    : `User has been actively working on ${projectEvolution.length} projects.`;

  log.info(`Generated reflection for the last ${days} days`);

  return {
    growth,
    completedGoals,
    projectEvolution,
    behaviorChanges
  };
}

export function weeklyReflection(): ReflectionSummary {
  return generateReflection(7);
}

export function monthlyReflection(): ReflectionSummary {
  return generateReflection(30);
}

export function yearlyReflection(): ReflectionSummary {
  return generateReflection(365);
}
