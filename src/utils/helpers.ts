// ════════════════════════════════════════════════════════════════════════════════
// src/utils/helpers.ts — Shared utility functions used across the entire app
// ════════════════════════════════════════════════════════════════════════════════

import { nanoid } from "nanoid";
import dayjs from "dayjs";
import timezone from "dayjs/plugin/timezone.js";
import utc from "dayjs/plugin/utc.js";
import relativeTime from "dayjs/plugin/relativeTime.js";
import { env } from "@config/index.js";

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(relativeTime);

// ─── ID Generation ────────────────────────────────────────────────────────────────
export const generateId = () => nanoid(12);
export const generateUUID = () => crypto.randomUUID();

// ─── Date & Time (IST-aware) ──────────────────────────────────────────────────────
export const now = () => dayjs().tz(env.USER_TIMEZONE);
export const formatDateTime = (d: Date | string | number) =>
  dayjs(d).tz(env.USER_TIMEZONE).format("ddd, D MMM YYYY [at] h:mm A");
export const fromNow = (d: Date | string | number) =>
  dayjs(d).tz(env.USER_TIMEZONE).fromNow();
export const isToday = (d: Date | string | number) =>
  dayjs(d).tz(env.USER_TIMEZONE).isSame(now(), "day");
export const currentHour = () => now().hour();

export function getGreeting(): string {
  const h = currentHour();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 17) return "Good afternoon";
  if (h >= 17 && h < 21) return "Good evening";
  return "Good night";
}

// ─── String Utilities ─────────────────────────────────────────────────────────────
export const truncate = (s: string, max: number) =>
  s.length <= max ? s : s.slice(0, max - 3) + "...";

export const normalizeText = (t: string) =>
  t.replace(/\r\n/g, "\n").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

export const firstWords = (t: string, n: number) => t.split(/\s+/).slice(0, n).join(" ");

// ─── Array Utilities ──────────────────────────────────────────────────────────────
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function unique<T>(arr: T[], key?: (i: T) => unknown): T[] {
  if (!key) return [...new Set(arr)];
  const seen = new Set<unknown>();
  return arr.filter((i) => {
    const k = key(i);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const randomPick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

// ─── Async Utilities ──────────────────────────────────────────────────────────────
export const sleep = (ms: number) => Bun.sleep(ms);

export async function pMap<T, R>(
  items: T[],
  mapper: (item: T, i: number) => Promise<R>,
  concurrency = 5
): Promise<R[]> {
  const results: R[] = [];
  for (const ch of chunk(items, concurrency)) {
    results.push(...(await Promise.all(ch.map((item, i) => mapper(item, i)))));
  }
  return results;
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label = "op"): Promise<T> {
  const t = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout: ${label} > ${ms}ms`)), ms)
  );
  return Promise.race([promise, t]);
}

// ─── Token estimation (rough ~4 chars/token) ─────────────────────────────────────
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export function trimToTokenBudget(text: string, maxTokens: number): string {
  const max = maxTokens * 4;
  return text.length <= max ? text : text.slice(0, max) + "\n[...truncated]";
}

// ─── Misc ─────────────────────────────────────────────────────────────────────────
const HINGLISH_ACKS = ["Accha!", "Bilkul!", "Theek hai", "Haan, sure", "Done!", "Samajh gaya"];
export const randomHinglishAck = () => randomPick(HINGLISH_ACKS);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((k) => [k, obj[k]])) as Pick<T, K>;
}
