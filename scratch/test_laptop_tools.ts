// ════════════════════════════════════════════════════════════════════════════════
// scratch/test_laptop_tools.ts — Automated testing for laptop tools and safety
// ════════════════════════════════════════════════════════════════════════════════

import { executeCommand } from "../src/tools/laptop/executor.js";
import { getBatteryStatus, getSystemInfo } from "../src/tools/laptop/system.js";
import { listDirectory, writeFileContent, deleteFile } from "../src/tools/laptop/fileSystem.js";
import { SafetyError } from "../src/utils/errorHandler.js";

async function runTests() {
  console.log("🧪 Starting Laptop Tools Testing...\n");

  // 1. Test System Info
  try {
    console.log("Testing System Info...");
    const battery = await getBatteryStatus();
    console.log(`✅ Battery: ${battery}`);
    const info = await getSystemInfo();
    console.log(`✅ OS: ${info.os}, Uptime: ${info.uptime}`);
  } catch (e) {
    console.error("❌ System Info Test Failed:", e);
  }

  // 2. Test File System
  try {
    console.log("\nTesting File System...");
    const testDir = "./temp_test";
    const testFile = `${testDir}/hello.txt`;
    
    await writeFileContent(testFile, "Hello from Creater Test!");
    console.log(`✅ File created: ${testFile}`);
    
    const list = await listDirectory(testDir);
    console.log(`✅ Listed directory: Found ${list.length} files`);
    
    await deleteFile(testFile);
    console.log(`✅ File deleted: ${testFile}`);
    
    // Cleanup dir (using shell)
    await executeCommand(`rmdir ${testDir}`); 
    console.log("✅ Temp directory cleaned up.");
  } catch (e) {
    console.error("❌ File System Test Failed:", e);
  }

  // 3. Test Shell Execution & Safety
  console.log("\nTesting Shell Execution & Safety...");
  
  // Safe command
  try {
    const res = await executeCommand("echo Hello World");
    console.log(`✅ Safe Command: stdout="${res.stdout}"`);
  } catch (e) {
    console.error("❌ Safe Command Failed:", e);
  }

  // Dangerous command (Blocked)
  try {
    console.log("Testing Blocked Command (rm -rf /)...");
    await executeCommand("rm -rf /");
    console.log("❌ Error: Dangerous command was NOT blocked!");
  } catch (e) {
    if (e instanceof Error && e.message.includes("blocked")) {
      console.log(`✅ Blocked Command correctly caught: ${e.message}`);
    } else {
      console.error("❌ Unexpected error on blocked command:", e);
    }
  }

  // Suspicious command (Confirmation required)
  try {
    console.log("Testing Suspicious Command (taskkill /f)...");
    await executeCommand("taskkill /f /im explorer.exe");
    console.log("❌ Error: Suspicious command was NOT flagged for confirmation!");
  } catch (e) {
    if (e instanceof Error && e.message.includes("confirmation")) {
      console.log(`✅ Suspicious Command correctly flagged: ${e.message}`);
    } else {
      console.error("❌ Unexpected error on suspicious command:", e);
    }
  }

  console.log("\n🏁 Testing Completed.");
}

runTests().catch(console.error);
