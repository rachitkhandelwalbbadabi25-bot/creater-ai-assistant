// src/tests/orchestrator/validator.test.ts
import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import {
  validateSuccess,
  validateArtifact,
  validateBrowserState,
  retry,
  ValidationError,
} from "../../orchestrator/validator.js";
import { browserSessionManager } from "../../mcp/browser/sessionManager.js";

const tmpFile = path.join(process.cwd(), "validation_test_temp.txt");

beforeEach(() => {
  if (fs.existsSync(tmpFile)) {
    fs.unlinkSync(tmpFile);
  }
});

afterEach(() => {
  if (fs.existsSync(tmpFile)) {
    fs.unlinkSync(tmpFile);
  }
});

describe("Validation System", () => {
  it("validateSuccess checks for success property", () => {
    expect(() => validateSuccess({ success: true })).not.toThrow();
    
    let err: ValidationError | null = null;
    try {
      validateSuccess({ success: false, msg: "failed" }, "step-1");
    } catch (e: any) {
      err = e;
    }
    expect(err).toBeInstanceOf(ValidationError);
    expect(err?.stepId).toBe("step-1");
    expect(err?.errorType).toBe("SUCCESS_VALIDATION_FAILED");
  });

  it("validateArtifact checks file existence and checksums", () => {
    expect(() => validateArtifact(tmpFile)).toThrow();

    fs.writeFileSync(tmpFile, "hello validation", "utf8");
    expect(() => validateArtifact(tmpFile)).not.toThrow();

    // Checksum matches: sha256 of "hello validation"
    const hash = "95669c62ef02ce3be6968593ffb4fbe687850fffaf7c733418ee939fae97bd02";
    expect(() => validateArtifact(tmpFile, { expectedChecksum: hash })).not.toThrow();

    // Checksum mismatch
    expect(() => validateArtifact(tmpFile, { expectedChecksum: "mismatch" })).toThrow();
  });

  it("validateBrowserState validates page predicate via sessionManager", async () => {
    // Stub browserSessionManager.getPage
    const originalGetPage = browserSessionManager.getPage;
    const mockPage = { url: () => "https://example.com" };
    
    // @ts-ignore
    browserSessionManager.getPage = (tabId: string) => {
      if (tabId === "tab-123") return mockPage as any;
      return undefined;
    };

    try {
      await expect(validateBrowserState("tab-123", (page) => page.url() === "https://example.com")).resolves.toBeUndefined();
      await expect(validateBrowserState("tab-123", (page) => page.url() === "https://google.com")).rejects.toThrow();
      await expect(validateBrowserState("tab-999", (page) => true)).rejects.toThrow();
    } finally {
      browserSessionManager.getPage = originalGetPage;
    }
  });

  it("retry integrates with the retry utility", async () => {
    let count = 0;
    const fn = async () => {
      count++;
      if (count < 2) throw new Error("try again");
      return "done";
    };
    const res = await retry(fn, { attempts: 3, delayMs: 5 });
    expect(res).toBe("done");
    expect(count).toBe(2);
  });
});
