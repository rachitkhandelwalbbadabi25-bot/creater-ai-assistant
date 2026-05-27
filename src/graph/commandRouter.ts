import { createLogger } from "@utils/logger.js";

const log = createLogger("graph/commandRouter");

export type FastCommand =
  | { kind: "open_app"; raw: string; app: string }
  | { kind: "open_url"; raw: string; url: string }
  | { kind: "open_path"; raw: string; path: string }
  | { kind: "open_downloads"; raw: string; path: string }
  | { kind: "close_app"; raw: string; app: string }
  | { kind: "browser_home"; raw: string }
  | { kind: "youtube"; raw: string; query?: string }
  | { kind: "volume"; raw: string; direction: "up" | "down" | "mute" };

export function normalizeCommandInput(input: string): string {
  return input
    .toLowerCase()
    .replace(/\b(please|kindly|can you|could you|please|bro|yaar)\b/g, "")
    .replace(/\b(open|launch|start|run|please open)\b/g, "open")
    .replace(/[!?.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripOpenVerb(text: string): string {
  return text.replace(/^open\s+/i, "").trim();
}

const APP_ALIASES = [
  { match: /^(notepad|notes?)$/i, app: "notepad" },
  { match: /^(calculator|calc)$/i, app: "calculator" },
  { match: /^(chrome|google chrome)$/i, app: "chrome" },
  { match: /^(edge|microsoft edge)$/i, app: "edge" },
  { match: /^(firefox)$/i, app: "firefox" },
  { match: /^(vscode|vs code|visual studio code|code)$/i, app: "vscode" },
  { match: /^(paint|mspaint)$/i, app: "paint" },
  { match: /^(explorer|file explorer|files?)$/i, app: "explorer" },
];

const DETERMINISTIC_COMMAND_MAP: Record<string, FastCommand> = {
  "open notepad": { kind: "open_app", raw: "open notepad", app: "notepad" },
  "open chrome": { kind: "open_app", raw: "open chrome", app: "chrome" },
  "open calculator": { kind: "open_app", raw: "open calculator", app: "calculator" },
  "open calc": { kind: "open_app", raw: "open calc", app: "calculator" },
  "open youtube": { kind: "youtube", raw: "open youtube" },
  "open downloads": { kind: "open_downloads", raw: "open downloads", path: "%USERPROFILE%\\Downloads" },
  "volume up": { kind: "volume", raw: "volume up", direction: "up" },
  "volume down": { kind: "volume", raw: "volume down", direction: "down" },
  mute: { kind: "volume", raw: "mute", direction: "mute" },
  unmute: { kind: "volume", raw: "unmute", direction: "mute" },
};

export function isDeterministicLaunchIntent(input: string): boolean {
  const normalized = normalizeCommandInput(input);
  if (normalized in DETERMINISTIC_COMMAND_MAP) return true;
  return (
    /^(open|launch|start)\s+(notepad|notes?|chrome|google chrome|calculator|calc|youtube|downloads?)$/i.test(normalized) ||
    /^(volume up|turn volume up|increase volume|louder|volume down|turn volume down|decrease volume|quieter|mute|unmute|toggle mute)$/i.test(normalized)
  );
}

export function routeFastCommand(input: string): FastCommand | null {
  const normalized = normalizeCommandInput(input);
  log.info("Fast router received command", { input, normalized });

  if (!normalized) return null;

  const deterministicCommand = DETERMINISTIC_COMMAND_MAP[normalized];
  if (deterministicCommand) {
    return { ...deterministicCommand, raw: input };
  }

  if (/^(https?:\/\/|www\.)/i.test(normalized)) {
    return {
      kind: "open_url",
      raw: input,
      url: /^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`,
    };
  }

  if (/^(volume up|turn volume up|increase volume|louder)$/i.test(normalized)) {
    return { kind: "volume", raw: input, direction: "up" };
  }

  if (/^(volume down|turn volume down|decrease volume|quieter)$/i.test(normalized)) {
    return { kind: "volume", raw: input, direction: "down" };
  }

  if (/^(mute|unmute|toggle mute)$/i.test(normalized)) {
    return { kind: "volume", raw: input, direction: "mute" };
  }

  if (/^(open|launch|start) youtube(\s|$)/i.test(normalized) || /\byoutube\b/i.test(normalized) && !/\b(play|search)\b/i.test(normalized)) {
    const query = normalized.match(/\bopen youtube(?:\s+(.*))?$/i)?.[1]?.trim();
    return {
      kind: "youtube",
      raw: input,
      ...(query ? { query } : {}),
    };
  }

  if (/^(open|launch|start) downloads?$/i.test(normalized)) {
    return {
      kind: "open_downloads",
      raw: input,
      path: "%USERPROFILE%\\Downloads",
    };
  }

  if (/^(open|launch|start) browser$/i.test(normalized) || /^(open|launch|start) web browser$/i.test(normalized)) {
    return { kind: "browser_home", raw: input };
  }

  if (/^(close|quit|exit)\s+(the\s+)?(browser|app)$/i.test(normalized)) {
    return { kind: "close_app", raw: input, app: "browser" };
  }

  if (/^(close|quit|exit)\s+/.test(normalized)) {
    const target = stripOpenVerb(normalized.replace(/^(close|quit|exit)\s+/, ""));
    if (target) {
      return { kind: "close_app", raw: input, app: target };
    }
  }

  if (/^(open|launch|start)\s+/.test(normalized)) {
    const target = stripOpenVerb(normalized);

    if (/^https?:\/\//i.test(target) || /^www\./i.test(target)) {
      return {
        kind: "open_url",
        raw: input,
        url: /^https?:\/\//i.test(target) ? target : `https://${target}`,
      };
    }

    if (target.includes("\\") || target.includes("/") || target.startsWith("~") || target.includes(":")) {
      return {
        kind: "open_path",
        raw: input,
        path: target,
      };
    }

    const alias = APP_ALIASES.find((entry) => entry.match.test(target));
    if (alias) {
      return { kind: "open_app", raw: input, app: alias.app };
    }
  }

  if (/^(browser|web)$/i.test(normalized)) {
    return { kind: "browser_home", raw: input };
  }

  return null;
}
