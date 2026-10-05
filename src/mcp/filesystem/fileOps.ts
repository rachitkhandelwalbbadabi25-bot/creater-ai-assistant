// src/mcp/filesystem/fileOps.ts
import * as fs from 'fs';
import * as path from 'path';
import { FileMCPError, DirectoryEntry, ValidatePathOptions, FileOperationResult } from './types';

/** Resolve a relative path against the sandbox root and ensure it stays inside the root */
function resolveSandboxPath(relPath: string): string {
  const root = process.env.FILE_ROOT ?? 'workspace';
  const absRoot = path.resolve(root);
  const resolved = path.resolve(absRoot, relPath);
  if (!resolved.startsWith(absRoot + path.sep) && resolved !== absRoot) {
    throw new FileMCPError(`Path escape attempt: ${relPath}`, 'ESCAPE_ATTEMPT', { resolved, root: absRoot });
  }
  return resolved;
}

/** Validate a path according to supplied options; throws FileMCPError on failure */
export function validatePath(relPath: string, opts: ValidatePathOptions = {}): void {
  const fullPath = resolveSandboxPath(relPath);
  const { mustExist, mustBeFile, mustBeDirectory } = opts;
  if (mustExist && !fs.existsSync(fullPath)) {
    throw new FileMCPError(`Path does not exist: ${relPath}`, 'NOT_FOUND');
  }
  if (mustBeFile && fs.existsSync(fullPath) && !fs.statSync(fullPath).isFile()) {
    throw new FileMCPError(`Path is not a file: ${relPath}`, 'NOT_A_FILE');
  }
  if (mustBeDirectory && fs.existsSync(fullPath) && !fs.statSync(fullPath).isDirectory()) {
    throw new FileMCPError(`Path is not a directory: ${relPath}`, 'NOT_A_DIRECTORY');
  }
}

/** Read a UTF‑8 text file inside the sandbox */
export async function readFile(relPath: string, encoding: BufferEncoding = 'utf8'): Promise<string> {
  const fullPath = resolveSandboxPath(relPath);
  try {
    return await fs.promises.readFile(fullPath, { encoding });
  } catch (err) {
    throw new FileMCPError(`Failed to read file: ${relPath}`, 'READ_ERROR', err);
  }
}

/** Write data to a file inside the sandbox, optionally atomically */
export async function writeFile(
  relPath: string,
  data: string | Buffer,
  opts: { atomic?: boolean } = {}
): Promise<FileOperationResult> {
  const fullPath = resolveSandboxPath(relPath);
  const dir = path.dirname(fullPath);
  try {
    await fs.promises.mkdir(dir, { recursive: true });
    if (opts.atomic) {
      const tempPath = `${fullPath}.tmp`;
      await fs.promises.writeFile(tempPath, data);
      await fs.promises.rename(tempPath, fullPath);
    } else {
      await fs.promises.writeFile(fullPath, data);
    }
    return { path: fullPath, success: true };
  } catch (err) {
    throw new FileMCPError(`Failed to write file: ${relPath}`, 'WRITE_ERROR', err);
  }
}

/** Create a folder inside the sandbox */
export async function createFolder(relPath: string): Promise<void> {
  const fullPath = resolveSandboxPath(relPath);
  try {
    await fs.promises.mkdir(fullPath, { recursive: true });
  } catch (err) {
    throw new FileMCPError(`Failed to create folder: ${relPath}`, 'MKDIR_ERROR', err);
  }
}

/** Move (rename) a file/folder inside the sandbox */
export async function moveFile(srcRel: string, destRel: string): Promise<void> {
  const src = resolveSandboxPath(srcRel);
  const dest = resolveSandboxPath(destRel);
  const destDir = path.dirname(dest);
  try {
    await fs.promises.mkdir(destDir, { recursive: true });
    await fs.promises.rename(src, dest);
  } catch (err) {
    throw new FileMCPError(`Failed to move ${srcRel} -> ${destRel}`, 'MOVE_ERROR', err);
  }
}

/** List entries in a directory */
export async function listDirectory(relPath: string): Promise<DirectoryEntry[]> {
  const fullPath = resolveSandboxPath(relPath);
  try {
    const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      path: path.join(fullPath, e.name),
      isDirectory: e.isDirectory(),
    }));
  } catch (err) {
    throw new FileMCPError(`Failed to list directory: ${relPath}`, 'LIST_ERROR', err);
  }
}

/** Copy a file/folder inside the sandbox */
export async function copyFile(srcRel: string, destRel: string): Promise<void> {
  const src = resolveSandboxPath(srcRel);
  const dest = resolveSandboxPath(destRel);
  const destDir = path.dirname(dest);
  try {
    await fs.promises.mkdir(destDir, { recursive: true });
    await fs.promises.copyFile(src, dest);
  } catch (err) {
    throw new FileMCPError(`Failed to copy ${srcRel} -> ${destRel}`, 'COPY_ERROR', err);
  }
}

/** Delete a file or directory inside the sandbox */
export async function removePath(relPath: string): Promise<void> {
  const fullPath = resolveSandboxPath(relPath);
  try {
    if (fs.existsSync(fullPath)) {
      const stats = await fs.promises.stat(fullPath);
      if (stats.isDirectory()) {
        await fs.promises.rm(fullPath, { recursive: true, force: true });
      } else {
        await fs.promises.unlink(fullPath);
      }
    }
  } catch (err) {
    throw new FileMCPError(`Failed to delete path: ${relPath}`, 'DELETE_ERROR', err);
  }
}

/** Get metadata statistics for a path */
export async function getMetadata(relPath: string): Promise<{
  name: string;
  path: string;
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  createdMs: number;
  modifiedMs: number;
}> {
  const fullPath = resolveSandboxPath(relPath);
  try {
    const stats = await fs.promises.stat(fullPath);
    return {
      name: path.basename(fullPath),
      path: fullPath,
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      createdMs: stats.birthtimeMs,
      modifiedMs: stats.mtimeMs,
    };
  } catch (err) {
    throw new FileMCPError(`Failed to get metadata for path: ${relPath}`, 'METADATA_ERROR', err);
  }
}

/** Recursively search for files whose names contain the query substring */
export async function searchFiles(query: string, options: { baseDir?: string } = {}): Promise<DirectoryEntry[]> {
  const baseRel = options.baseDir ?? '.';
  const basePath = resolveSandboxPath(baseRel);
  const results: DirectoryEntry[] = [];
  async function walk(dir: string) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const entryPath = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(entryPath);
      } else if (e.name.includes(query)) {
        results.push({ name: e.name, path: entryPath, isDirectory: false });
      }
    }
  }
  try {
    await walk(basePath);
    return results;
  } catch (err) {
    throw new FileMCPError(`Search failed for query "${query}"`, 'SEARCH_ERROR', err);
  }
}
