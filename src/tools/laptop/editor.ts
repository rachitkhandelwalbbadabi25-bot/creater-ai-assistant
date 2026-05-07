// ════════════════════════════════════════════════════════════════════════════════
// src/tools/laptop/editor.ts — VS Code + Git integration
// ════════════════════════════════════════════════════════════════════════════════

import simpleGit from "simple-git";
import { exec } from "./executor.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("tools/editor");

export async function openInVSCode(path: string, line?: number): Promise<void> {
  const cmd = line ? `code --goto "${path}:${line}"` : `code "${path}"`;
  log.tool(`Opening in VS Code: ${path}`);
  await exec(cmd);
}

export async function gitStatus(repoPath: string) {
  const git = simpleGit(repoPath);
  const status = await git.status();
  return {
    branch: status.current,
    staged: status.staged,
    modified: status.modified,
    untracked: status.not_added,
    ahead: status.ahead,
    behind: status.behind,
    isClean: status.isClean(),
  };
}

export async function gitCommit(repoPath: string, message: string): Promise<string> {
  const git = simpleGit(repoPath);
  await git.add(".");
  const result = await git.commit(message);
  log.tool(`Git commit: ${message}`, { hash: result.commit });
  return result.commit;
}

export async function gitLog(repoPath: string, count = 5) {
  const git = simpleGit(repoPath);
  const logResult = await git.log({ maxCount: count });
  return logResult.all.map(e => ({
    hash: e.hash.slice(0, 7),
    message: e.message,
    author: e.author_name,
    date: e.date,
  }));
}

export async function gitDiff(repoPath: string): Promise<string> {
  const git = simpleGit(repoPath);
  return git.diff();
}
