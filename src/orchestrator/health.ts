// src/orchestrator/health.ts

import { globalQueueManager, MAX_CONCURRENT_WORKFLOWS } from './queueManager.js';
import { browserSessionManager } from '../mcp/browser/sessionManager';

export interface OrchestratorHealth {
  activeWorkflows: number;
  queuedWorkflows: number;
  maxConcurrentWorkflows: number;
  activeTaskIds: string[];
  queuedTaskIds: string[];
}

/**
 * Returns a snapshot of the orchestrator's current health/status.
 */
export function getOrchestratorHealth(): OrchestratorHealth {
  return {
    activeWorkflows: globalQueueManager.getActiveCount(),
    queuedWorkflows: globalQueueManager.getQueuedCount(),
    maxConcurrentWorkflows: MAX_CONCURRENT_WORKFLOWS,
    activeTaskIds: globalQueueManager.getActiveTaskIds(),
    queuedTaskIds: globalQueueManager.getQueuedTaskIds(),
  };
}
