// src/tests/os.processTracking.test.ts
import { describe, it, expect, afterEach } from 'bun:test';
import { openApp, listLaunchedProcesses, isTrackedProcess, cleanupLaunchedProcesses } from '../mcp/os/osOps.js';

describe('OS Process Tracking', () => {
  afterEach(async () => {
    await cleanupLaunchedProcesses();
  });

  it('should track opened process and clean up idempotently', async () => {
    const pid = await openApp('node', ['-e', 'setTimeout(()=>{}, 2000)']);
    const pids = listLaunchedProcesses();
    expect(pids).toContain(pid);
    expect(isTrackedProcess(pid)).toBe(true);

    // Cleanup first time
    await cleanupLaunchedProcesses();
    expect(isTrackedProcess(pid)).toBe(false);
    expect(listLaunchedProcesses()).not.toContain(pid);

    // Cleanup again – should be idempotent and not throw
    await cleanupLaunchedProcesses();
    expect(isTrackedProcess(pid)).toBe(false);
  });
});
