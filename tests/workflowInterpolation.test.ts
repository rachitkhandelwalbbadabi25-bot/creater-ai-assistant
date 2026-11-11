// ════════════════════════════════════════════════════════════════════════════════
// tests/workflowInterpolation.test.ts — Workflow Interpolation Test Suite
// ════════════════════════════════════════════════════════════════════════════════

import { describe, test, expect } from "./bunTestPolyfill.js";
import {
  interpolateString,
  interpolateValue,
  resolveVariablePath,
  getNestedProperty,
} from "../src/workflow/interpolator.js";
import type { WorkflowExecutionContext } from "../src/workflow/types.js";
import { WorkflowError } from "../src/workflow/types.js";

describe("Workflow Parameter Interpolation Suite", () => {
  const sampleContext: WorkflowExecutionContext = {
    workflowId: "wf_test_interp",
    correlationId: "corr_123",
    variables: {
      userId: "usr_999",
      userEmail: "test@example.com",
      config: {
        timeout: 5000,
        env: "production",
      },
    },
    stepResults: {
      search_step: {
        url: "https://example.com/result",
        itemCount: 42,
        metadata: {
          tag: "analytics",
        },
      },
      fetch_step: "raw_response_body",
    },
  };

  test("1. Simple variable interpolation (vars.userId)", () => {
    const res = interpolateString("https://api.com/users/{{ vars.userId }}", sampleContext);
    expect(res).toBe("https://api.com/users/usr_999");
  });

  test("2. Nested variable interpolation (vars.config.env)", () => {
    const res = interpolateString("Current env: {{ vars.config.env }}", sampleContext);
    expect(res).toBe("Current env: production");
  });

  test("3. Direct step output resolution (steps.fetch_step.output)", () => {
    const res = interpolateString("Output: {{ steps.fetch_step.output }}", sampleContext);
    expect(res).toBe("Output: raw_response_body");
  });

  test("4. Nested step output resolution (steps.search_step.output.url)", () => {
    const res = interpolateString("URL is {{ steps.search_step.output.url }}", sampleContext);
    expect(res).toBe("URL is https://example.com/result");
  });

  test("5. Multiple templates in a single string", () => {
    const res = interpolateString(
      "User {{ vars.userId }} ({{ vars.userEmail }}) fetched {{ steps.search_step.output.url }}",
      sampleContext
    );
    expect(res).toBe("User usr_999 (test@example.com) fetched https://example.com/result");
  });

  test("6. Preserves direct non-string output type when exact match", () => {
    const res = interpolateString("{{ steps.search_step.output.itemCount }}", sampleContext);
    expect(res).toBe(42);

    const objRes = interpolateString("{{ vars.config }}", sampleContext);
    expect(objRes).toEqual({ timeout: 5000, env: "production" });
  });

  test("7. Throws clear WorkflowError for missing variable in path", () => {
    expect(() => {
      interpolateString("Hello {{ vars.nonExistentKey }}", sampleContext);
    }).toThrow(WorkflowError);
  });

  test("8. Throws WorkflowError for invalid namespace root", () => {
    expect(() => {
      resolveVariablePath("invalid_namespace.foo", sampleContext);
    }).toThrow(WorkflowError);
  });

  test("9. Security: Prevents access to __proto__, prototype, and constructor", () => {
    expect(() => {
      getNestedProperty(sampleContext.variables, ["__proto__"], "wf_test");
    }).toThrow(WorkflowError);

    expect(() => {
      interpolateString("{{ vars.__proto__ }}", sampleContext);
    }).toThrow(WorkflowError);

    expect(() => {
      interpolateString("{{ vars.constructor }}", sampleContext);
    }).toThrow(WorkflowError);
  });

  test("10. Non-string values pass through unchanged", () => {
    expect(interpolateValue(123, sampleContext)).toBe(123);
    expect(interpolateValue(true, sampleContext)).toBe(true);
    expect(interpolateValue(null, sampleContext)).toBeNull();
  });

  test("11. Deeply nested objects and arrays are interpolated without mutating original input", () => {
    const originalInput = {
      endpoint: "https://api.com/{{ vars.userId }}",
      payload: {
        email: "{{ vars.userEmail }}",
        count: "{{ steps.search_step.output.itemCount }}",
      },
      tags: ["env-{{ vars.config.env }}", "static-tag"],
    };

    const copyInput = JSON.parse(JSON.stringify(originalInput));
    const result = interpolateValue(originalInput, sampleContext);

    expect(result).toEqual({
      endpoint: "https://api.com/usr_999",
      payload: {
        email: "test@example.com",
        count: 42,
      },
      tags: ["env-production", "static-tag"],
    } as any);

    // Verify original input was NOT mutated
    expect(originalInput).toEqual(copyInput);
  });
});
