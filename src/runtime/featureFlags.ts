import { createLogger } from "@utils/logger.js";

const log = createLogger("runtime/featureFlags");
const runtimeEnv = process.env as Record<string, string | undefined>;

function readBooleanFlag(name: string, defaultValue: boolean): boolean {
  const raw = runtimeEnv[name];
  if (raw == null) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export const ENABLE_PROACTIVE_RUNTIME = readBooleanFlag("ENABLE_PROACTIVE_RUNTIME", false);
export const ENABLE_ORCHESTRATION_RUNTIME = readBooleanFlag("ENABLE_ORCHESTRATION_RUNTIME", false);
export const ENABLE_AUTONOMOUS_AGENTS = readBooleanFlag("ENABLE_AUTONOMOUS_AGENTS", false);
export const ENABLE_BACKGROUND_RETRIEVAL = readBooleanFlag("ENABLE_BACKGROUND_RETRIEVAL", false);

export const runtimeFeatureFlags = {
  proactiveRuntime: ENABLE_PROACTIVE_RUNTIME,
  orchestrationRuntime: ENABLE_ORCHESTRATION_RUNTIME,
  autonomousAgents: ENABLE_AUTONOMOUS_AGENTS,
  backgroundRetrieval: ENABLE_BACKGROUND_RETRIEVAL,
} as const;

export function isProactiveRuntimeEnabled(): boolean {
  return ENABLE_PROACTIVE_RUNTIME;
}

export function isOrchestrationRuntimeEnabled(): boolean {
  return ENABLE_ORCHESTRATION_RUNTIME;
}

let bootLogsPrinted = false;

export function logRuntimeFeatureFlags(): void {
  if (bootLogsPrinted) return;
  bootLogsPrinted = true;

  log.info("Core runtime initialized", runtimeFeatureFlags);
  console.log("CORE RUNTIME INITIALIZED");
  if (!ENABLE_ORCHESTRATION_RUNTIME) {
    log.info("Orchestration runtime disabled by feature flag");
    console.log("ORCHESTRATION RUNTIME DISABLED");
  }
  if (!ENABLE_PROACTIVE_RUNTIME) {
    log.info("Proactive systems disabled by feature flag");
    console.log("PROACTIVE SYSTEMS DISABLED");
  }
  if (!ENABLE_BACKGROUND_RETRIEVAL) {
    log.info("Background retrieval disabled by feature flag");
    console.log("BACKGROUND RETRIEVAL DISABLED");
  }
  if (!ENABLE_AUTONOMOUS_AGENTS) {
    log.info("Autonomous agents disabled by feature flag");
    console.log("AUTONOMOUS AGENTS DISABLED");
  }
}
