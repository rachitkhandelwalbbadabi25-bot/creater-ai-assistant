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

let bootLogsPrinted = false;

export function logRuntimeFeatureFlags(): void {
  if (bootLogsPrinted) return;
  bootLogsPrinted = true;

  console.log("CORE RUNTIME INITIALIZED");
  if (!ENABLE_ORCHESTRATION_RUNTIME) {
    console.log("ORCHESTRATION RUNTIME DISABLED");
  }
  if (!ENABLE_PROACTIVE_RUNTIME) {
    console.log("PROACTIVE SYSTEMS DISABLED");
  }
  if (!ENABLE_BACKGROUND_RETRIEVAL) {
    console.log("BACKGROUND RETRIEVAL DISABLED");
  }
  if (!ENABLE_AUTONOMOUS_AGENTS) {
    console.log("AUTONOMOUS AGENTS DISABLED");
  }
}
