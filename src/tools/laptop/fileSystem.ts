// ════════════════════════════════════════════════════════════════════════════════
// src/tools/laptop/fileSystem.ts — Safe file system operations
// ════════════════════════════════════════════════════════════════════════════════

import { readFile, writeFile, unlink, readdir, stat, mkdir, rename, copyFile as copyFileFs, rm } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve, extname, dirname, basename } from "path";
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
  if (existsSync(fullPath)) {
    const stats = await stat(fullPath);
    if (stats.isDirectory()) {
      await rm(fullPath, { recursive: true, force: true });
    } else {
      await unlink(fullPath);
    }
  }
}

export async function createDirectory(dirPath: string): Promise<void> {
  const fullPath = resolve(dirPath);
  const safety = validateFileOp("write", fullPath);
  if (!safety.allowed) throw new SafetyError(`Directory creation blocked: ${safety.reason}`);

  log.tool(`Creating directory: ${fullPath}`);
  await mkdir(fullPath, { recursive: true });
}

export async function moveFile(srcPath: string, destPath: string): Promise<void> {
  const srcFull = resolve(srcPath);
  const destFull = resolve(destPath);

  const srcSafety = validateFileOp("read", srcFull);
  const destSafety = validateFileOp("write", destFull);
  if (!srcSafety.allowed || !destSafety.allowed) {
    throw new SafetyError(`Move operation blocked: ${srcSafety.reason || destSafety.reason}`);
  }
  if (destSafety.requiresConfirmation) {
    throw new SafetyError(`Move requires confirmation: ${destFull}`);
  }

  const destDir = dirname(destFull);
  if (!existsSync(destDir)) await mkdir(destDir, { recursive: true });

  log.tool(`Moving: ${srcFull} -> ${destFull}`);
  await rename(srcFull, destFull);
}

export async function copyFile(srcPath: string, destPath: string): Promise<void> {
  const srcFull = resolve(srcPath);
  const destFull = resolve(destPath);

  const srcSafety = validateFileOp("read", srcFull);
  const destSafety = validateFileOp("write", destFull);
  if (!srcSafety.allowed || !destSafety.allowed) {
    throw new SafetyError(`Copy operation blocked: ${srcSafety.reason || destSafety.reason}`);
  }

  const destDir = dirname(destFull);
  if (!existsSync(destDir)) await mkdir(destDir, { recursive: true });

  log.tool(`Copying: ${srcFull} -> ${destFull}`);
  await copyFileFs(srcFull, destFull);
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

export async function searchFiles(query: string, baseDir = "."): Promise<FileInfo[]> {
  const fullBase = resolve(baseDir);
  if (!existsSync(fullBase)) throw new ToolError("fs.search_files", `Base directory not found: ${fullBase}`);

  const results: FileInfo[] = [];

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
      } else if (entry.name.includes(query)) {
        const stats = await stat(entryPath).catch(() => null);
        results.push({
          name: entry.name,
          path: entryPath,
          isDirectory: false,
          size: stats ? formatBytes(stats.size) : "unknown",
          extension: extname(entry.name),
        });
      }
    }
  }

  await walk(fullBase);
  log.tool(`Found ${results.length} files matching query "${query}"`);
  return results;
}

export async function getFileMetadata(path: string): Promise<{
  name: string;
  path: string;
  size: string;
  sizeBytes: number;
  isFile: boolean;
  isDirectory: boolean;
  createdMs: number;
  modifiedMs: number;
}> {
  const fullPath = resolve(path);
  if (!existsSync(fullPath)) throw new ToolError("fs.file_metadata", `File/directory not found: ${fullPath}`);

  const stats = await stat(fullPath);
  return {
    name: basename(fullPath),
    path: fullPath,
    size: formatBytes(stats.size),
    sizeBytes: stats.size,
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    createdMs: stats.birthtimeMs,
    modifiedMs: stats.mtimeMs,
  };
}
