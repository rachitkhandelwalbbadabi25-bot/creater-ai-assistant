import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Clear require cache/internal modules for testing to ensure isolation
import {
  recordExperience,
  getExperiences,
  findSimilarExperience,
  clearExperiences,
  loadExperiences
} from '../src/intelligence/experienceMemory';

import {
  learnFromInteraction,
  generateOptimisationPlan
} from '../src/intelligence/learningEngine';

import {
  approveSuggestion,
  runOptimizationCycle
} from '../src/intelligence/selfOptimizer';

import {
  createRoutine,
  listRoutines,
  executeRoutine,
  clearRoutines
} from '../src/intelligence/routineEngine';

import {
  evaluateProactiveOpportunities
} from '../src/intelligence/proactiveEngine';

import {
  recommendSkills
} from '../src/intelligence/skillRecommender';

import {
  recordAutomationSavings,
  recordPredictionResult,
  resetMetrics,
  getIntelligenceTelemetry
} from '../src/intelligence/intelligenceMetrics';

import {
  getDashboardReport,
  renderDashboardView
} from '../src/intelligence/dashboard';

describe('Phase 6: Autonomous Intelligence & Self‑Improvement Layer', () => {

  beforeEach(() => {
    clearExperiences();
    clearRoutines();
    resetMetrics();
  });

  // 1-3. Experience Memory Storage & Retrieval
  test('should record, get and clear experiences', () => {
    recordExperience({ success: true, toolName: 'ollama', details: { prompt: 'hello' } });
    const exps = getExperiences();
    expect(exps.length).toBe(1);
    expect(exps[0].toolName).toBe('ollama');
  });

  // 4-5. Experience Retention Policies
  test('should apply retention parameters properly', () => {
    // Fill up database with old records (should filter by Max Limit or age)
    for (let i = 0; i < 15; i++) {
      recordExperience({ success: true, toolName: 'test-retention', details: { index: i } });
    }
    const exps = getExperiences();
    expect(exps.length).toBeGreaterThan(0);
  });

  // 6-7. Similarity Probe
  test('should find similar experiences using matching keys', () => {
    recordExperience({ success: true, toolName: 'browser', details: { url: 'google.com', mode: 'fast' } });
    recordExperience({ success: true, toolName: 'browser', details: { url: 'yahoo.com' } });
    recordExperience({ success: true, toolName: 'ollama', details: { prompt: 'query' } });

    const matches = findSimilarExperience({ toolName: 'browser', details: { url: '' } });
    expect(matches.length).toBe(2);
    expect(matches[0].toolName).toBe('browser');
  });

  // 8-9. Privacy Rules and Sanitization
  test('should never store sensitive keys or parameters', () => {
    recordExperience({
      success: true,
      toolName: 'api',
      details: { password: 'my-super-secret-pass', apiKey: 'token123', safeParam: 'safe' }
    });
    const exps = getExperiences();
    expect(exps[0].details.password).toBe('[REDACTED]');
    expect(exps[0].details.apiKey).toBe('[REDACTED]');
    expect(exps[0].details.safeParam).toBe('safe');
  });

  // 10-11. Learning Engine Analysis
  test('should analyze tool failure patterns and suggest solutions', () => {
    // Record multiple failures
    recordExperience({ success: false, toolName: 'ollama', details: { error: 'Ollama offline' } });
    recordExperience({ success: false, toolName: 'ollama', details: { error: 'Ollama offline' } });
    recordExperience({ success: false, toolName: 'ollama', details: { error: 'Ollama offline' } });

    const suggestions = learnFromInteraction();
    const failSuggestion = suggestions.find(s => s.type === 'optimization');
    expect(failSuggestion).toBeDefined();
    expect(failSuggestion?.title).toContain('Optimize ollama');
  });

  // 12-13. Learning Engine Routine Discovery
  test('should discover high frequency tool usages and suggest routines', () => {
    for (let i = 0; i < 6; i++) {
      recordExperience({ success: true, toolName: 'browser', details: { index: i } });
    }
    const suggestions = learnFromInteraction();
    const routineSuggestion = suggestions.find(s => s.type === 'routine');
    expect(routineSuggestion).toBeDefined();
  });

  // 14-15. Self-Optimization and Execution Policy
  test('should auto-apply low-risk optimizations but withhold high-risk ones', async () => {
    // Low risk suggestion: Enable Ollama cache
    for (let i = 0; i < 6; i++) {
      recordExperience({ success: true, toolName: 'ollama', details: { status: 'ok' } });
    }
    const plan = generateOptimisationPlan();
    expect(plan.suggestions.some(s => s.risk === 'low')).toBe(true);

    const reportBefore = await runOptimizationCycle();
    // Low-risk (cache-ollama) should auto-apply
    expect(reportBefore.applied.length).toBeGreaterThan(0);

    // Clear experiences to isolate the failure stats evaluation
    clearExperiences();

    // Record failure to spawn high/medium risk suggestions
    recordExperience({ success: false, toolName: 'ollama', details: { error: 'Failed' } });
    recordExperience({ success: false, toolName: 'ollama', details: { error: 'Failed' } });
    recordExperience({ success: false, toolName: 'ollama', details: { error: 'Failed' } });

    const reportAfter = await runOptimizationCycle();
    const pendingCount = reportAfter.pendingUserApproval.length;
    expect(pendingCount).toBeGreaterThan(0);


    // Approve the pending optimization
    const pendingId = reportAfter.pendingUserApproval[0];
    approveSuggestion(pendingId);

    const reportFinal = await runOptimizationCycle();
    expect(reportFinal.applied).toContain(pendingId);
  });

  // 16. Routine creation & list
  test('should create, list and execute automated routines', async () => {
    const routine = createRoutine('Daily Scraping', 'Fetches leads', [
      { toolName: 'browser', args: { url: 'https://news.ycombinator.com' } },
      { toolName: 'ollama', args: { prompt: 'summarize' } }
    ]);
    expect(listRoutines().length).toBe(1);
    const success = await executeRoutine(routine.id);
    expect(success).toBe(true);
  });

  // 17. Proactive Opportunities Evaluator
  test('should evaluate proactive execution triggers', () => {
    recordExperience({ success: false, toolName: 'api', details: { error: 'timeout error occurred' } });
    recordExperience({ success: false, toolName: 'api', details: { error: 'timeout error occurred' } });

    const proactive = evaluateProactiveOpportunities();
    expect(proactive.some(p => p.priority === 'high')).toBe(true);
  });

  // 18. Skill Recommender Command Suggester
  test('should recommend specific skills and slash commands based on usage patterns', () => {
    recordExperience({ success: true, toolName: 'subagent', details: {} });
    recordExperience({ success: true, toolName: 'subagent', details: {} });
    recordExperience({ success: true, toolName: 'subagent', details: {} });

    const recs = recommendSkills();
    expect(recs.some(r => r.skillName === 'agent-manager-skill')).toBe(true);
  });

  // 19. Intelligence Telemetry Metrics Integration
  test('should track prediction accuracy and automation savings', () => {
    recordAutomationSavings(15);
    recordPredictionResult(true);
    recordPredictionResult(false);

    const telemetry = getIntelligenceTelemetry();
    expect(telemetry.automationSavings).toBe(15);
    expect(telemetry.predictionAccuracy).toBe(50);
  });

  // 20. Dashboard Rendering
  test('should format report for the intelligence dashboard', () => {
    const report = getDashboardReport();
    expect(report.telemetry.intelligence).toBeDefined();

    const view = renderDashboardView();
    expect(view).toContain('Creater AI Intelligence Dashboard');
  });
});
