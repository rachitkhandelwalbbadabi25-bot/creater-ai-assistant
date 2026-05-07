// ════════════════════════════════════════════════════════════════════════════════
// src/tools/external/api.ts — External API client for web requests
// ════════════════════════════════════════════════════════════════════════════════

import axios from "axios";
import { createLogger } from "@utils/logger.js";

const log = createLogger("tools/api");

export async function httpGet(url: string, headers?: Record<string, string>): Promise<unknown> {
  log.tool(`GET ${url}`);
  const resp = await axios.get(url, { headers, timeout: 15000 });
  return resp.data;
}

export async function httpPost(url: string, data: unknown, headers?: Record<string, string>): Promise<unknown> {
  log.tool(`POST ${url}`);
  const resp = await axios.post(url, data, { headers, timeout: 15000 });
  return resp.data;
}
