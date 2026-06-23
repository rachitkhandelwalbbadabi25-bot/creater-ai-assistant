// ════════════════════════════════════════════════════════════════════════════════
// src/utils/contextBuilder.ts — Build rich context for LLM from memory + emotion + projects
// ════════════════════════════════════════════════════════════════════════════════

import { env } from "@config/index.js";
import { getGreeting, now, formatDateTime, estimateTokens, trimToTokenBudget } from "./helpers.js";
import { createLogger } from "./logger.js";

const log = createLogger("contextBuilder");

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface UserContext {
  userName: string;
  greeting: string;
  currentTime: string;
  timezone: string;
  dayOfWeek: string;
}

export interface EmotionContext {
  currentMood: string;
  confidence: number;
  energyLevel?: string;
  recentMoods?: string[];
}

import type { SystemSnapshot } from "@tools/laptop/system.js";
import type { Fact } from "@memory/longTerm.js";

export interface MemoryContext {
  recentMessages: string[];
  relevantMemories: string[];
  activeProjects?: string[];
  pendingTasks?: string[];
  upcomingDeadlines?: string[];
  systemStatus?: SystemSnapshot;
  userProfileFacts?: Fact[];
  graphContext?: string;
}

export interface FullContext {
  user: UserContext;
  emotion: EmotionContext | null;
  memory: MemoryContext;
  tokenCount: number;
}

export interface ContextRenderOptions {
  includeUser?: boolean;
  includeTime?: boolean;
  includeGreeting?: boolean;
  includeEmotion?: boolean;
  includeSystemStatus?: boolean;
  includeProfileFacts?: boolean;
  includeGraphContext?: boolean;
}

const DEFAULT_CONTEXT_RENDER_OPTIONS: Required<ContextRenderOptions> = {
  includeUser: true,
  includeTime: true,
  includeGreeting: true,
  includeEmotion: true,
  includeSystemStatus: true,
  includeProfileFacts: true,
  includeGraphContext: true,
};

// ─── Context Builder ──────────────────────────────────────────────────────────────

/**
 * Builds the current user context — always available (no LLM needed).
 */
export function buildUserContext(): UserContext {
  const currentTime = now();
  return {
    userName: env.USER_NAME,
    greeting: getGreeting(),
    currentTime: formatDateTime(currentTime.toDate()),
    timezone: env.USER_TIMEZONE,
    dayOfWeek: currentTime.format("dddd"),
  };
}

/**
 * Assembles a full context object from all available sources.
 * Used as the "preamble" injected before each LLM call.
 */
export function buildFullContext(
  emotion: EmotionContext | null,
  memory: MemoryContext
): FullContext {
  const user = buildUserContext();
  const ctx: FullContext = { user, emotion, memory, tokenCount: 0 };
  ctx.tokenCount = estimateTokens(contextToString(ctx));
  return ctx;
}

/**
 * Serializes a FullContext into a string block suitable for
 * injection into an LLM system/user prompt.
 */
export function contextToString(
  ctx: FullContext,
  maxTokens = 2048,
  options: ContextRenderOptions = {}
): string {
  const renderOptions = { ...DEFAULT_CONTEXT_RENDER_OPTIONS, ...options };
  const sections: string[] = [];

  if (renderOptions.includeUser) {
    const userLines = [`[USER CONTEXT]`, `Name: ${ctx.user.userName}`];
    if (renderOptions.includeTime) {
      userLines.push(`Time: ${ctx.user.currentTime} (${ctx.user.timezone})`);
      userLines.push(`Day: ${ctx.user.dayOfWeek}`);
    }
    if (renderOptions.includeGreeting) {
      userLines.push(`Greeting: ${ctx.user.greeting}`);
    }
    sections.push(...userLines);
  }

  // Emotion section
  if (renderOptions.includeEmotion && ctx.emotion) {
    sections.push(
      `\n[EMOTIONAL STATE]`,
      `Mood: ${ctx.emotion.currentMood} (confidence: ${(ctx.emotion.confidence * 100).toFixed(0)}%)`,
      ctx.emotion.energyLevel ? `Energy: ${ctx.emotion.energyLevel}` : "",
      ctx.emotion.recentMoods?.length
        ? `Recent moods: ${ctx.emotion.recentMoods.join(" → ")}`
        : ""
    );
  }

  // System status section (Laptop info)
  if (renderOptions.includeSystemStatus && ctx.memory.systemStatus) {
    sections.push(
      `\n[SYSTEM STATUS]`,
      `OS: ${ctx.memory.systemStatus.os}`,
      `CPU: ${ctx.memory.systemStatus.cpu.usage}% used`,
      `RAM: ${ctx.memory.systemStatus.ram.usagePercent}% used (${ctx.memory.systemStatus.ram.used}/${ctx.memory.systemStatus.ram.total})`,
      ctx.memory.systemStatus.battery ? `Battery: ${ctx.memory.systemStatus.battery.percent}% (${ctx.memory.systemStatus.battery.charging ? "Charging" : "Discharging"})` : "AC Power"
    );
  }

  // Memory section
  if (ctx.memory.relevantMemories.length > 0) {
    sections.push(
      `\n[RELEVANT MEMORIES (RAG)]`,
      ...ctx.memory.relevantMemories.map((m, i) => `  ${i + 1}. ${m}`)
    );
  }

  if (renderOptions.includeProfileFacts && ctx.memory.userProfileFacts && ctx.memory.userProfileFacts.length > 0) {
    sections.push(
      `\n[USER PROFILE & FACTS]`,
      ...ctx.memory.userProfileFacts.map(f => `  • ${f.key}: ${f.value}`)
    );
  }

  if (ctx.memory.activeProjects?.length) {
    sections.push(
      `\n[ACTIVE PROJECTS]`,
      ...ctx.memory.activeProjects.map((p) => `  • ${p}`)
    );
  }

  if (ctx.memory.pendingTasks?.length) {
    sections.push(
      `\n[PENDING TASKS]`,
      ...ctx.memory.pendingTasks.map((t) => `  ☐ ${t}`)
    );
  }

  if (ctx.memory.upcomingDeadlines?.length) {
    sections.push(
      `\n[UPCOMING DEADLINES]`,
      ...ctx.memory.upcomingDeadlines.map((d) => `  ⏰ ${d}`)
    );
  }

  if (renderOptions.includeGraphContext && ctx.memory.graphContext) {
    sections.push(`\n${ctx.memory.graphContext}`);
  }

  const raw = sections.filter(Boolean).join("\n");
  return trimToTokenBudget(raw, maxTokens);
}

/**
 * Build a minimal context for fast operations (routing, classification).
 * Uses fewer tokens than the full context.
 */
export function buildLightContext(): string {
  const user = buildUserContext();
  return [
    `User: ${user.userName}`,
    `Time: ${user.currentTime}`,
    `Day: ${user.dayOfWeek}`,
  ].join(" | ");
}
