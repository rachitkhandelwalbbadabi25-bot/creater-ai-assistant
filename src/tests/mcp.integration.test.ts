// src/tests/mcp.integration.test.ts
import { describe, it, expect, afterEach } from 'bun:test';
import { openApp, clipboard, processCheck, cleanupLaunchedProcesses } from '../mcp/os/osOps.js';
import { writeFile, readFile, moveFile, searchFiles } from '../mcp/filesystem/fileOps.js';
import { browserSessionManager } from '../mcp/browser/sessionManager.js';
import { validateSuccess, validateBrowserState } from '../orchestrator/validator.js';
import * as path from 'path';

const TEMP_DIR = 'temp_test_dir';

async function ensureTempDir() {
  await writeFile(`${TEMP_DIR}/placeholder.txt`, 'placeholder');
}

describe('MCP Integration Flow', () => {
  afterEach(async () => {
    await cleanupLaunchedProcesses?.();
    await browserSessionManager.cleanupAll();
  });

  it('should execute filesystem, OS, browser, and validator steps without leaks', async () => {
    // Filesystem MCP steps
    await ensureTempDir();
    const filePath = `${TEMP_DIR}/test.txt`;
    await writeFile(filePath, 'hello world');
    const content = await readFile(filePath);
    expect(content).toBe('hello world');
    const movedPath = `${TEMP_DIR}/moved.txt`;
    await moveFile(filePath, movedPath);
    const searchResult = await searchFiles('moved.txt', { baseDir: TEMP_DIR });
    const paths = searchResult.map(r => r.path);
    const absMovedPath = path.resolve(movedPath);
    expect(paths).toContain(absMovedPath);

    // OS MCP steps
    await clipboard('write', 'clipboard data');
    const clip = await clipboard('read');
    expect(clip).toBe('clipboard data');
    const pid = await openApp('node', ['-e', 'setTimeout(()=>{}, 1000)']);
    const check = processCheck(pid);
    expect(check.status).toBe('running');

    // Browser MCP steps
    const tabId = await browserSessionManager.openTab();
    const page = browserSessionManager.getPage(tabId);
    if (!page) throw new Error('Page not found');
    await page.goto('about:blank');
    await validateBrowserState(tabId, async (p) => (await p.title()) === 'about:blank');
    await browserSessionManager.closeTab(tabId);

    // Validator step
    validateSuccess({ success: true });
  });
});
