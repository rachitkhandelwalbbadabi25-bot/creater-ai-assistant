// src/monitoring/logger.ts

import { createLogger } from "@utils/logger.js";

// Dedicated logger for the monitoring subsystem – separates its output from the main LLM logger.
export const monitoringLog = createLogger("monitoring");
