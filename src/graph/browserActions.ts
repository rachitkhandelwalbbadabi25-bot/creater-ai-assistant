import { launchBrowserHome, launchYouTube } from "./appLauncher.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("graph/browserActions");

export async function openBasicBrowser() {
  log.info("Opening basic browser");
  console.log("[PLAYWRIGHT PATH]", "src/graph/browserActions.ts", "openBasicBrowser", "https://www.google.com");
  console.log("[BROWSER NAVIGATION]", "https://www.google.com");
  return launchBrowserHome();
}

export async function openYouTube(query?: string) {
  log.info("Opening YouTube", { query });
  console.log("[PLAYWRIGHT PATH]", "src/graph/browserActions.ts", "openYouTube", query ?? "https://www.youtube.com");
  return launchYouTube(query);
}
