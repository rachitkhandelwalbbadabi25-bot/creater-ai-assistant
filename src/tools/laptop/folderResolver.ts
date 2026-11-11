import path from "node:path";
import os from "node:os";
import { existsSync, mkdirSync } from "node:fs";

export function getHomeDir(): string {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

export interface SpecialFolderMatch {
  folderKey: string;
  displayName: string;
  path: string;
}

/**
 * Resolves natural folder names (e.g. "screenshot folder", "my screenshots", "Documents")
 * to absolute OS filesystem paths without hardcoding specific username strings.
 */
export function resolveSpecialFolder(input: string): SpecialFolderMatch | null {
  if (!input) return null;

  const normalized = input
    .toLowerCase()
    .trim()
    .replace(/^(?:the|my)\s+/i, "")
    .trim();

  const home = getHomeDir();

  let folderKey = "";
  let displayName = "";
  let relativeSubpath: string[] = [];

  // 1. Screenshots
  if (/^(?:screenshots?|screenshots?\s+folders?|screenshot\s+dir|screenshots?\s+directory)$/i.test(normalized)) {
    folderKey = "screenshots";
    displayName = "Screenshots folder";
    relativeSubpath = ["Pictures", "Screenshots"];
  }
  // 2. Documents
  else if (/^(?:documents?|documents?\s+folders?|document\s+dir|documents?\s+directory|my\s+docs?)$/i.test(normalized)) {
    folderKey = "documents";
    displayName = "Documents folder";
    relativeSubpath = ["Documents"];
  }
  // 3. Desktop
  else if (/^(?:desktop|desktop\s+folders?|desktop\s+dir|desktop\s+directory)$/i.test(normalized)) {
    folderKey = "desktop";
    displayName = "Desktop folder";
    relativeSubpath = ["Desktop"];
  }
  // 4. Pictures / Photos
  else if (/^(?:pictures?|photos?|pictures?\s+folders?|photos?\s+folders?|picture\s+dir|pictures?\s+directory)$/i.test(normalized)) {
    folderKey = "pictures";
    displayName = "Pictures folder";
    relativeSubpath = ["Pictures"];
  }
  // 5. Music
  else if (/^(?:music|music\s+folders?|music\s+dir|music\s+directory)$/i.test(normalized)) {
    folderKey = "music";
    displayName = "Music folder";
    relativeSubpath = ["Music"];
  }
  // 6. Videos
  else if (/^(?:videos?|video\s+folders?|videos?\s+folders?|video\s+dir|videos?\s+directory)$/i.test(normalized)) {
    folderKey = "videos";
    displayName = "Videos folder";
    relativeSubpath = process.platform === "darwin" ? ["Movies"] : ["Videos"];
  }
  // 7. Downloads
  else if (/^(?:downloads?|downloads?\s+folders?|download\s+dir|downloads?\s+directory)$/i.test(normalized)) {
    folderKey = "downloads";
    displayName = "Downloads folder";
    relativeSubpath = ["Downloads"];
  }

  if (relativeSubpath.length === 0) {
    return null;
  }

  const resolvedPath = path.join(home, ...relativeSubpath);

  // Ensure standard OS folder exists if missing
  if (!existsSync(resolvedPath)) {
    try {
      mkdirSync(resolvedPath, { recursive: true });
    } catch {
      // Ignore directory creation errors if parent permission restricted
    }
  }

  return {
    folderKey,
    displayName,
    path: resolvedPath,
  };
}
