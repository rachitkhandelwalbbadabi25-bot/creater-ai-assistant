import { launchUrl } from "../src/graph/appLauncher.js";
(async () => {
  const result = await launchUrl("https://example.com");
  console.log("Result:", result);
})();
