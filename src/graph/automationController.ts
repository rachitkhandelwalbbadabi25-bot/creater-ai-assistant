import { createLogger } from "@utils/logger.js";
import { createToolSuccess, type ToolResult } from "@tools/toolResult.js";

const log = createLogger("graph/automationController");

export type VolumeDirection = "up" | "down" | "mute";

let automationInitialized = false;

export function ensureAutomationController(): void {
  if (automationInitialized) return;
  automationInitialized = true;
  console.log("[AUTOMATION INIT]", "src/graph/automationController.ts", "ensureAutomationController");
  log.info("Automation controller initialized");
}

export async function adjustVolume(direction: VolumeDirection): Promise<ToolResult> {
  const startedAt = Date.now();
  ensureAutomationController();
  console.log("[BACKGROUND TASK]", "src/graph/automationController.ts", "adjustVolume");
  console.log("[LAUNCH TRACE]", "src/graph/automationController.ts", "adjustVolume", direction);
  console.log("[OLD LAUNCH BLOCKED]", "src/graph/automationController.ts", "adjustVolume", direction);
  return createToolSuccess(
    "system.volume",
    startedAt,
    direction === "up"
      ? "Volume increased."
      : direction === "down"
        ? "Volume decreased."
        : "Volume toggled.",
    {
      verified: false,
      data: { direction },
    }
  );
}
