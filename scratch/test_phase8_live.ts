import { dispatchTool } from "../src/tools/dispatcher";
import { mcpCoordinator } from "../src/mcp/coordinator";
import { executeCuaAction } from "../src/cua/cuaEngine";
import { launchApp } from "../src/tools/laptop/launcher";

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runLiveTest() {
  console.log("\n==================================================");
  console.log("   🚀 CREATER AI - PHASE 8 LIVE VERIFICATION");
  console.log("==================================================\n");

  // Step 1: Multi-MCP Server Registry Discovery
  console.log("📦 [1/4] Listing Registered MCP Servers & Tools...");
  const serversRes = await dispatchTool("mcp.list_servers", {});
  console.log("Registered MCP Servers:", serversRes.data.servers.map((s: any) => `${s.name} (${s.toolCount} tools)`));

  // Step 2: Cross-MCP Pipeline (OS + Filesystem)
  console.log("\n⛓️ [2/4] Executing Cross-MCP Pipeline (OS Stats + Root Directory Scan)...");
  const pipelineRes = await mcpCoordinator.executePipeline([
    { serverName: "os", toolName: "os_stats", params: {} },
    { serverName: "filesystem", toolName: "list_directory", params: { path: "." } }
  ]);
  console.log("Pipeline Status:", pipelineRes.success ? "SUCCESS ✅" : "FAILED ❌");
  console.log("OS Platform:", pipelineRes.results[0]?.output?.platform, "| Free RAM:", Math.round((pipelineRes.results[0]?.output?.freeMemoryBytes || 0) / (1024 * 1024 * 1024)), "GB");
  console.log("Filesystem Root File Count:", pipelineRes.results[1]?.output?.entries?.length || 0);

  // Step 3: Inspect Active Foreground Window via CUA
  console.log("\n🔍 [3/4] Inspecting Active Foreground Window via Native CUA...");
  const winRes = await dispatchTool("cua.active_window", {});
  console.log("Active Window Title:", winRes.data?.title || "Unknown");
  console.log("Window Bounds:", winRes.data?.bounds);

  // Step 4: Live Desktop CUA Interaction (Launch Notepad -> Type Text -> Inspect)
  console.log("\n💻 [4/4] Interactive Native CUA: Launching Notepad & Auto-Typing...");
  await launchApp("notepad");
  await sleep(1500);

  console.log("Focusing Notepad & typing message via native CUA keyboard events...");
  await executeCuaAction({
    action: "type",
    text: "Hello Rachit! Phase 8 Advanced CUA & Multi-MCP is successfully operating on your machine!\n-- Creater AI Cognitive OS\n"
  });

  console.log("\n✅ [Phase 8 Live Verification Complete] Check your Notepad window!\n");
}

runLiveTest().catch(console.error);

