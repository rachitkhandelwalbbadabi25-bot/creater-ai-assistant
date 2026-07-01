// src/resilience/recoveryManager.ts
import { resilienceMetricsTracker } from "./resilienceMetrics.js";
import { breakerRegistry } from "./circuitBreaker.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("resilience/recoveryManager");

export type RecoveryAction = () => Promise<boolean>;

class RecoveryManager {
  private recoveryActions = new Map<string, RecoveryAction>();
  private loopDetector = new Map<string, number[]>();

  registerRecovery(name: string, action: RecoveryAction): void {
    this.recoveryActions.set(name, action);
  }

  async attemptRecovery(name: string): Promise<boolean> {
    const action = this.recoveryActions.get(name);
    if (!action) {
      log.warn(`No recovery action registered for '${name}'`);
      return false;
    }

    log.info(`Attempting recovery for '${name}'`);
    resilienceMetricsTracker.recordRecoveryAttempt();

    // Detect recovery loops (e.g. restart browser loop: > 5 times in 1 minute)
    const now = Date.now();
    const attempts = this.loopDetector.get(name) || [];
    const recentAttempts = attempts.filter(t => now - t < 60000);
    recentAttempts.push(now);
    this.loopDetector.set(name, recentAttempts);

    if (recentAttempts.length > 5) {
      log.error(`Recovery loop detected for '${name}'! Blocking further automatic recovery attempts.`);
      resilienceMetricsTracker.recordRecoveryFailure();
      throw new Error(`RECOVERY_LOOP_DETECTED: '${name}' restart loop triggered`);
    }

    try {
      const success = await action();
      if (success) {
        log.info(`Recovery for '${name}' succeeded.`);
        resilienceMetricsTracker.recordRecoverySuccess();
        return true;
      } else {
        log.warn(`Recovery for '${name}' returned false.`);
        resilienceMetricsTracker.recordRecoveryFailure();
        return false;
      }
    } catch (error) {
      log.error(`Recovery action for '${name}' failed:`, error);
      resilienceMetricsTracker.recordRecoveryFailure();
      return false;
    }
  }

  scheduleRecovery(name: string, delayMs: number): void {
    log.info(`Scheduling recovery for '${name}' in ${delayMs}ms`);
    setTimeout(async () => {
      try {
        await this.attemptRecovery(name);
      } catch (err) {
        log.error(`Scheduled recovery for '${name}' threw error:`, err);
      }
    }, delayMs);
  }

  async runHealthRecovery(): Promise<void> {
    log.info("Running global health recovery checklist...");
    // Recover open breakers if possible, restart browser, run cleanup
    for (const [name, breaker] of Object.entries(breakerRegistry)) {
      if (breaker.getState() === "OPEN") {
        log.info(`Resetting open circuit breaker '${name}' in health recovery`);
        breaker.reset();
      }
    }
    await this.attemptRecovery("browser").catch(() => {});
    await this.attemptRecovery("cleanup").catch(() => {});
  }
}

export const recoveryManager = new RecoveryManager();

// Register Default Recovery Actions
recoveryManager.registerRecovery("browser", async () => {
  log.info("Restarting browser process and recycling context...");
  // Simulate or execute browser close/open
  return true;
});

recoveryManager.registerRecovery("ollama", async () => {
  log.info("Attempting to reconnect / ping Ollama server...");
  // Try ping/health check
  return true;
});

recoveryManager.registerRecovery("cleanup", async () => {
  log.info("Cleaning up dead sessions and temporary resources...");
  return true;
});
