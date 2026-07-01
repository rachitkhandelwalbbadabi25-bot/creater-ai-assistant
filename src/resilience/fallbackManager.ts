// src/resilience/fallbackManager.ts
import { resilienceMetricsTracker } from "./resilienceMetrics.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("resilience/fallbackManager");

export type FallbackFn<T = any> = (error: Error) => T | Promise<T>;

class FallbackManager {
  private fallbacks = new Map<string, FallbackFn>();

  registerFallback<T>(name: string, fallback: FallbackFn<T>): void {
    this.fallbacks.set(name, fallback);
  }

  getFallback(name: string): FallbackFn | undefined {
    return this.fallbacks.get(name);
  }

  async executeFallback<T>(name: string, error: Error): Promise<T> {
    const fallback = this.getFallback(name);
    if (!fallback) {
      log.warn(`No fallback registered for '${name}'`);
      throw error;
    }

    log.info(`Executing fallback for '${name}' due to error: ${error.message}`);
    resilienceMetricsTracker.recordFallback(name);
    try {
      return await fallback(error);
    } catch (fallbackError) {
      log.error(`Fallback '${name}' execution failed:`, fallbackError);
      throw fallbackError;
    }
  }
}

export const fallbackManager = new FallbackManager();

// Register Default Fallbacks
fallbackManager.registerFallback("ollama", (err) => {
  log.info("Default Ollama fallback: switching to smaller local mock model config");
  return {
    model: "qwen2.5:0.5b",
    fallbackActive: true,
    message: "Fallback model selected because primary was offline."
  };
});

fallbackManager.registerFallback("browser", (err) => {
  log.info("Default Browser fallback: fallback to fetchMode direct HTTP client scrape");
  return {
    fetchMode: true,
    fallbackActive: true,
    message: "Browser failed; scraping source content directly via HTTP."
  };
});

fallbackManager.registerFallback("screenshot", (err) => {
  log.info("Default Screenshot fallback: extracting raw text instead");
  return "Unable to capture visual screenshot; falling back to extracted page text contents.";
});

fallbackManager.registerFallback("embedding", (err) => {
  log.info("Default Embedding fallback: empty vector returned");
  return new Array(1536).fill(0);
});

fallbackManager.registerFallback("api", (err) => {
  log.info("Default API fallback: return cached response if available");
  return {
    cached: true,
    fallbackActive: true,
    data: {},
  };
});

fallbackManager.registerFallback("shell", (err) => {
  log.info("Default Shell fallback: returning structured error details");
  return {
    success: false,
    exitCode: -1,
    stdout: "",
    stderr: `Shell command failed: ${err.message}`,
  };
});
