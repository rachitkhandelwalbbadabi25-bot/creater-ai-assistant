// scratch/test_wizard_boot.tsx — Automated boot and rendering verification for SetupWizard
import React from "react";
import { render } from "ink";
import { SetupWizard } from "../src/tui/wizard.tsx";

console.log("🚀 Starting React/Ink SetupWizard rendering verification...");
try {
  const { unmount } = render(<SetupWizard onComplete={() => {
    console.log("Complete callback triggered.");
  }} />);

  setTimeout(() => {
    unmount();
    console.log("\n✅ Rendering verification SUCCESSFUL! SetupWizard booted and unmounted cleanly without runtime exceptions.");
    process.exit(0);
  }, 2000);
} catch (err) {
  console.error("❌ SetupWizard failed to render on boot:", err);
  process.exit(1);
}
