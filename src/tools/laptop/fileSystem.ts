// ════════════════════════════════════════════════════════════════════════════════
// src/tools/laptop/fileSystem.ts — Safe file system operations
// ════════════════════════════════════════════════════════════════════════════════

import { readFile, writeFile, unlink, readdir, stat, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, extname } from "path";
import { validateFileOp } from "../safety.js";
import { SafetyError, ToolError } from "@utils/errorHandler.js";
import { createLogger } from "@utils/logger.js";
import { formatBytes } from "@utils/helpers.js";

const log = createLogger("tools/fileSystem");

export async function readFileContent(path: string, encoding: BufferEncoding = "utf-8"): Promise<string> {
  const fullPath = resolve(path);
  const safety = validateFileOp("read", fullPath);
  if (!safety.allowed) throw new SafetyError(`Read blocked: ${safety.reason}`);
  if (!existsSync(fullPath)) throw new ToolError("fs.read_file", `File not found: ${fullPath}`);

  log.tool(`Reading: ${fullPath}`);
  return readFile(fullPath, encoding);
}

export async function writeFileContent(path: string, content: string, append = false): Promise<void> {
  const fullPath = resolve(path);
  const safety = validateFileOp("write", fullPath);
  if (!safety.allowed) throw new SafetyError(`Write blocked: ${safety.reason}`);
  if (safety.requiresConfirmation) {
    throw new SafetyError(`Write requires confirmation: ${fullPath}`, { path: fullPath });
  }

  // Ensure directory exists
  const dir = join(fullPath, "..");
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });

  log.tool(`Writing: ${fullPath} (append=${append})`);
  if (append) {
    const existing = existsSync(fullPath) ? await readFile(fullPath, "utf-8") : "";
    await writeFile(fullPath, existing + content, "utf-8");
  } else {
    await writeFile(fullPath, content, "utf-8");
  }
}

export async function deleteFile(path: string): Promise<void> {
  const fullPath = resolve(path);
  const safety = validateFileOp("delete", fullPath);
  if (!safety.allowed) throw new SafetyError(`Delete blocked: ${safety.reason}`);
  if (safety.requiresConfirmation) {
    throw new SafetyError(`Delete requires confirmation: ${fullPath}`);
  }

  log.tool(`Deleting: ${fullPath}`);
  await unlink(fullPath);
}

export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size: string;
  extension: string;
}

export async function listDirectory(dirPath: string, pattern?: string): Promise<FileInfo[]> {
  const fullPath = resolve(dirPath);
  if (!existsSync(fullPath)) throw new ToolError("fs.list_directory", `Directory not found: ${fullPath}`);

  const entries = await readdir(fullPath, { withFileTypes: true });
  const results: FileInfo[] = [];

  for (const entry of entries) {
    if (pattern && !entry.name.match(new RegExp(pattern.replace(/\*/g, ".*")))) continue;
    const entryPath = join(fullPath, entry.name);
    const stats = await stat(entryPath).catch(() => null);
    results.push({
      name: entry.name,
      path: entryPath,
      isDirectory: entry.isDirectory(),
      size: stats ? formatBytes(stats.size) : "unknown",
      extension: entry.isDirectory() ? "" : extname(entry.name),
    });
  }

  log.tool(`Listed ${results.length} entries in ${fullPath}`);
  return results;
}
