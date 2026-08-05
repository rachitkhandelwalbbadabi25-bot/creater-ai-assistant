// src/tests/filesystem.stress.test.ts
import { describe, it, expect, afterEach } from 'bun:test';
import { writeFile, readFile, moveFile, searchFiles } from '../mcp/filesystem/fileOps.js';
import { promises as fs } from 'fs';
import { join } from 'path';
import { cleanupLaunchedProcesses } from '../mcp/os/osOps.js';
import { browserSessionManager } from '../mcp/browser/sessionManager.js';

const SANDBOX_ROOT = 'sandbox_test_dir';

async function ensureSandbox() {
  await writeFile(`${SANDBOX_ROOT}/.keep`, '');
}

async function cleanSandbox() {
  // Recursively delete sandbox directory
  await fs.rm(SANDBOX_ROOT, { recursive: true, force: true }).catch(() => {});
}

describe('Filesystem Stress Test', () => {
  afterEach(async () => {
    await cleanupLaunchedProcesses();
    await browserSessionManager.cleanupAll();
    await cleanSandbox();
  });

  it('should handle many writes, reads, moves, and searches atomically and securely', async () => {
    await ensureSandbox();
    const filenames: string[] = [];
    // 100 writes
    for (let i = 0; i < 100; i++) {
      const name = `file_${i}.txt`;
      const path = `${SANDBOX_ROOT}/${name}`;
      await writeFile(path, `content ${i}`);
      filenames.push(name);
    }
    // 100 reads
    for (let i = 0; i < 100; i++) {
      const path = `${SANDBOX_ROOT}/${filenames[i]}`;
      const content = await readFile(path);
      expect(content).toBe(`content ${i}`);
    }
    // 100 moves to a subdirectory
    const destDir = `${SANDBOX_ROOT}/moved`;
    await writeFile(`${destDir}/.keep`, ''); // ensure dest exists
    for (let i = 0; i < 100; i++) {
      const src = `${SANDBOX_ROOT}/${filenames[i]}`;
      const dest = `${destDir}/${filenames[i]}`;
      await moveFile(src, dest);
    }
    // 100 searches
    const results = await searchFiles('file_*.txt', { baseDir: destDir });
    expect(results.length).toBe(100);
    // Ensure no files escaped sandbox (attempt to write outside should fail)
    let threw = false;
    try {
      // @ts-ignore – intentionally malicious path
      await writeFile(`../outside.txt`, 'malicious');
    } catch (_) {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
