import { routeFastCommand, isDeterministicLaunchIntent } from "../graph/commandRouter.js";
import { classifyRuntimeMode } from "../runtime/RuntimeModeClassifier.js";
import { resolveSpecialFolder } from "../tools/laptop/folderResolver.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${msg}`);
  }
}

console.log("=== RUNNING FOLDER & ACTION ROUTING TESTS ===");

// 1. Special Folder Resolver Tests
const screenshotsMatch = resolveSpecialFolder("screenshot folder");
assert(screenshotsMatch !== null && screenshotsMatch.folderKey === "screenshots", "resolveSpecialFolder('screenshot folder') -> screenshots");

const myDocsMatch = resolveSpecialFolder("my documents");
assert(myDocsMatch !== null && myDocsMatch.folderKey === "documents", "resolveSpecialFolder('my documents') -> documents");

const desktopMatch = resolveSpecialFolder("the desktop folder");
assert(desktopMatch !== null && desktopMatch.folderKey === "desktop", "resolveSpecialFolder('the desktop folder') -> desktop");

// 2. Local Action Commands -> routeFastCommand
const cmd1 = routeFastCommand("open screenshot folder");
assert(cmd1?.kind === "open_path" && cmd1.path.toLowerCase().includes("screenshots"), "open screenshot folder -> open_path Screenshots");

const cmd2 = routeFastCommand("open screenshots");
assert(cmd2?.kind === "open_path" && cmd2.path.toLowerCase().includes("screenshots"), "open screenshots -> open_path Screenshots");

const cmd3 = routeFastCommand("show me screenshot folder");
assert(cmd3?.kind === "open_path" && cmd3.path.toLowerCase().includes("screenshots"), "show me screenshot folder -> open_path Screenshots");

const cmd4 = routeFastCommand("go to screenshots");
assert(cmd4?.kind === "open_path" && cmd4.path.toLowerCase().includes("screenshots"), "go to screenshots -> open_path Screenshots");

const cmd5 = routeFastCommand("take me to screenshots");
assert(cmd5?.kind === "open_path" && cmd5.path.toLowerCase().includes("screenshots"), "take me to screenshots -> open_path Screenshots");

const cmd6 = routeFastCommand("find screenshot folder");
assert(cmd6?.kind === "open_path" && cmd6.path.toLowerCase().includes("screenshots"), "find screenshot folder -> open_path Screenshots");

const cmd7 = routeFastCommand("find my screenshots");
assert(cmd7?.kind === "open_path" && cmd7.path.toLowerCase().includes("screenshots"), "find my screenshots -> open_path Screenshots");

const cmd8 = routeFastCommand("open Documents");
assert(cmd8?.kind === "open_path" && cmd8.path.toLowerCase().includes("documents"), "open Documents -> open_path Documents");

const cmd9 = routeFastCommand("find the Downloads folder");
assert(cmd9?.kind === "open_path" && cmd9.path.toLowerCase().includes("downloads"), "find the Downloads folder -> open_path Downloads");

const cmd10 = routeFastCommand("find my Documents");
assert(cmd10?.kind === "open_path" && cmd10.path.toLowerCase().includes("documents"), "find my Documents -> open_path Documents");

// 3. Web Search Preservation Tests
const webCmd1 = routeFastCommand("search screenshot folder");
assert(webCmd1 === null, "'search screenshot folder' -> null (web search)");

const webCmd2 = routeFastCommand("search Google for screenshot folder");
assert(webCmd2 === null, "'search Google for screenshot folder' -> null (web search)");

const webCmd3 = routeFastCommand("find information about screenshot tools");
assert(webCmd3 === null, "'find information about screenshot tools' -> null (web search)");

const webCmd4 = routeFastCommand("find latest AI news");
assert(webCmd4 === null, "'find latest AI news' -> null (web search)");

const webCmd5 = routeFastCommand("look up AI agents");
assert(webCmd5 === null, "'look up AI agents' -> null (web search)");

// 4. Runtime Mode Classification Tests
const mode1 = classifyRuntimeMode("open screenshot folder");
assert(mode1.mode === "execution" && mode1.executionSource === "direct-launch", "classifyRuntimeMode('open screenshot folder') -> execution & direct-launch");

const mode2 = classifyRuntimeMode("find screenshot folder");
assert(mode2.mode === "execution" && mode2.executionSource === "direct-launch", "classifyRuntimeMode('find screenshot folder') -> execution & direct-launch");

const mode3 = classifyRuntimeMode("show me screenshot folder");
assert(mode3.mode === "execution" && mode3.executionSource === "direct-launch", "classifyRuntimeMode('show me screenshot folder') -> execution & direct-launch");

const mode4 = classifyRuntimeMode("find information about AI");
assert(mode4.executionSource !== "direct-launch", "classifyRuntimeMode('find information about AI') -> not direct-launch");

const mode5 = classifyRuntimeMode("show me latest AI news");
assert(mode5.executionSource !== "direct-launch", "classifyRuntimeMode('show me latest AI news') -> not direct-launch");

// 5. Existing Command Preservations
const app1 = routeFastCommand("open Chrome");
assert(app1?.kind === "open_app" && app1.app === "chrome", "open Chrome -> open_app chrome");

const app2 = routeFastCommand("open Notepad");
assert(app2?.kind === "open_app" && app2.app === "notepad", "open Notepad -> open_app notepad");

const yt1 = routeFastCommand("play CarryMinati videos on YouTube");
assert(yt1?.kind === "youtube" && yt1.action === "play" && yt1.query === "CarryMinati", "play CarryMinati videos on YouTube -> youtube play");

const vol1 = routeFastCommand("volume up");
assert(vol1?.kind === "volume" && vol1.direction === "up", "volume up -> volume up");

console.log("\n🎉 ALL FOLDER & ACTION ROUTING TESTS PASSED!");
