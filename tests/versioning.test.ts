// tests/versioning.test.ts
import { expect, test, describe, beforeAll } from "bun:test";
import { initDatabase } from "../src/memory/db";
import { recordVersionChange, getVersionHistory, compareVersions, rollbackVersion } from "../src/memory/versioning";
import { generateId } from "../src/utils/helpers";
import { recordEvent, getTimeline } from "../src/memory/timeline";

describe("Memory Versioning System Tests", () => {
  beforeAll(() => {
    initDatabase();
  });

  test("Record version change and verify history", () => {
    const entityId = generateId();
    recordVersionChange("preference", entityId, "English", "Hinglish");

    const history = getVersionHistory("preference", entityId);
    expect(history.length).toBe(1);
    expect(history[0]!.previousValue).toBe("English");
    expect(history[0]!.newValue).toBe("Hinglish");
  });

  test("Compare versions returning differences", () => {
    const entityId = generateId();
    const v1 = recordVersionChange("preference", entityId, null, "English");
    const v2 = recordVersionChange("preference", entityId, "English", "Hinglish");

    const diffResult = compareVersions(v1, v2);
    expect(diffResult.diff).toContain("English");
    expect(diffResult.diff).toContain("Hinglish");
  });

  test("Rollback timeline event to previous version", () => {
    const event = recordEvent("achievement", "Startup Pitch", "Initial version", 0.8);
    const versionId = recordVersionChange("timeline_event", event.id, JSON.stringify({ category: "achievement", title: "Startup Pitch" }), JSON.stringify({ category: "achievement", title: "Startup Pitch (Enhanced)" }));

    // Rollback
    const rolled = rollbackVersion(versionId);
    expect(rolled).toBe(true);

    const timeline = getTimeline({ category: "achievement" });
    const found = timeline.find(e => e.id === event.id);
    expect(found!.title).toBe("Startup Pitch"); // Restored back to Startup Pitch
  });
});
