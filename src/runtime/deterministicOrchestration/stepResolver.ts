// src/runtime/deterministicOrchestration/stepResolver.ts
//
// Deterministically maps a raw command string to a { toolId, params } pair.
// NO LLM calls — pure pattern matching only.
// This is the bridge between the parser and the dispatcher.

export interface ResolvedTool {
  toolId: string;
  params: Record<string, unknown>;
}

// ─── URL helpers ──────────────────────────────────────────────────────────────

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s) || /^www\./i.test(s);
}

function normalizeUrl(s: string): string {
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

// ─── Domain shortcuts ─────────────────────────────────────────────────────────

const DOMAIN_MAP: Record<string, string> = {
  youtube: "https://www.youtube.com",
  "you tube": "https://www.youtube.com",
  google: "https://www.google.com",
  gmail: "https://mail.google.com",
  github: "https://github.com",
  twitter: "https://twitter.com",
  x: "https://x.com",
  reddit: "https://www.reddit.com",
  netflix: "https://www.netflix.com",
  spotify: "https://open.spotify.com",
  facebook: "https://www.facebook.com",
  instagram: "https://www.instagram.com",
  linkedin: "https://www.linkedin.com",
  whatsapp: "https://web.whatsapp.com",
  wikipedia: "https://www.wikipedia.org",
};

function domainUrl(site: string): string | null {
  return DOMAIN_MAP[site.toLowerCase()] ?? null;
}

// ─── App shortcuts ────────────────────────────────────────────────────────────

const APP_NAMES = new Set([
  "chrome", "google chrome",
  "edge", "microsoft edge",
  "firefox",
  "notepad",
  "calculator", "calc",
  "paint", "mspaint",
  "vscode", "vs code", "visual studio code",
  "explorer", "file explorer",
  "word", "excel", "powerpoint", "outlook",
  "settings",
  "task manager",
  "spotify",
  "discord",
  "slack",
  "zoom",
  "telegram",
]);

// ─── Main resolver ────────────────────────────────────────────────────────────

/**
 * Resolves a raw command string into a deterministic tool call.
 * Returns null if the command cannot be mapped (caller falls back to laptopAgent).
 */
export function resolveStep(command: string): ResolvedTool | null {
  const cmd = command.trim().toLowerCase();

  // ── Screenshot ──────────────────────────────────────────────────────────────
  if (/^(take\s+)?(a\s+)?screenshot(\s+of\s+.*)?$/.test(cmd) || cmd === "screenshot") {
    return { toolId: "computer.screenshot", params: {} };
  }

  // ── YouTube search / play ───────────────────────────────────────────────────
  const ytPlayMatch = cmd.match(/^(?:play|search youtube(?:\s+for)?|search\s+on\s+youtube(?:\s+for)?)[\s:]+(.+)$/);
  if (ytPlayMatch) {
    return { toolId: "computer.play_youtube", params: { query: ytPlayMatch[1].trim() } };
  }

  // ── Google search ───────────────────────────────────────────────────────────
  const googleMatch = cmd.match(/^(?:google|search(?:\s+google)?(?:\s+for)?)[\s:]+(.+)$/);
  if (googleMatch) {
    const query = encodeURIComponent(googleMatch[1].trim());
    return { toolId: "browser.navigate", params: { url: `https://www.google.com/search?q=${query}` } };
  }

  // ── Search YouTube (keyword variant) ───────────────────────────────────────
  const ytSearchMatch = cmd.match(/^search\s+(?:for\s+)?(.+?)\s+on\s+youtube$/);
  if (ytSearchMatch) {
    return { toolId: "computer.play_youtube", params: { query: ytSearchMatch[1].trim() } };
  }

  // ── Navigate to explicit URL ────────────────────────────────────────────────
  if (isUrl(cmd)) {
    return { toolId: "browser.navigate", params: { url: normalizeUrl(cmd) } };
  }

  // ── open <site> ─────────────────────────────────────────────────────────────
  const openMatch = cmd.match(/^(?:open|launch|go to|navigate to)\s+(.+)$/);
  if (openMatch) {
    const target = openMatch[1].trim();

    // explicit URL in the target
    if (isUrl(target)) {
      return { toolId: "browser.navigate", params: { url: normalizeUrl(target) } };
    }

    // known website
    const siteUrl = domainUrl(target);
    if (siteUrl) {
      return { toolId: "browser.navigate", params: { url: siteUrl } };
    }

    // known desktop app
    if (APP_NAMES.has(target)) {
      return { toolId: "system.open_app", params: { app: target } };
    }

    // looks like a URL without protocol
    if (/\.\w{2,}/.test(target)) {
      return { toolId: "browser.navigate", params: { url: `https://${target}` } };
    }

    // treat as app name (best-effort)
    return { toolId: "system.open_app", params: { app: target } };
  }

  // ── System commands ─────────────────────────────────────────────────────────
  if (/^(shutdown|power off)$/.test(cmd)) {
    return { toolId: "shell.execute", params: { command: "shutdown /s /t 0" } };
  }
  if (/^(restart|reboot)$/.test(cmd)) {
    return { toolId: "shell.execute", params: { command: "shutdown /r /t 0" } };
  }
  if (/^(lock|lock screen|lock pc|lock computer)$/.test(cmd)) {
    return { toolId: "shell.execute", params: { command: "rundll32.exe user32.dll,LockWorkStation" } };
  }

  // ── Volume ──────────────────────────────────────────────────────────────────
  if (/volume up|increase volume/.test(cmd)) {
    return { toolId: "computer.press_key", params: { key: "volumeup" } };
  }
  if (/volume down|decrease volume/.test(cmd)) {
    return { toolId: "computer.press_key", params: { key: "volumedown" } };
  }
  if (/^(mute|unmute|toggle mute)$/.test(cmd)) {
    return { toolId: "computer.press_key", params: { key: "volumemute" } };
  }

  // ── Cannot resolve deterministically ───────────────────────────────────────
  return null;
}
