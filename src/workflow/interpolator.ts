// ════════════════════════════════════════════════════════════════════════════════
// src/workflow/interpolator.ts — Context Parameter Interpolation Engine (Phase 6.4)
// Safe, prototype-pollution-free parameter template resolver.
// ════════════════════════════════════════════════════════════════════════════════

import type { WorkflowExecutionContext } from "./types.js";
import { WorkflowError } from "./types.js";

/** Forbidden property access tokens for prototype pollution safety */
const UNSAFE_PROPERTIES = new Set(["__proto__", "prototype", "constructor"]);

/** Template extraction pattern: {{ token }} */
const TEMPLATE_REGEX = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

/**
 * Safely navigates nested properties on an object using a dot-path.
 */
export function getNestedProperty(obj: unknown, pathParts: string[], workflowId = "unknown"): unknown {
  let current: any = obj;

  for (const part of pathParts) {
    if (UNSAFE_PROPERTIES.has(part)) {
      throw new WorkflowError(
        `Security violation: access to forbidden property '${part}' is prohibited.`,
        "VALIDATION_ERROR",
        workflowId
      );
    }

    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

/**
 * Resolves a single dot-path variable against WorkflowExecutionContext.
 * Supports:
 * - `vars.myVar` -> context.variables.myVar
 * - `steps.stepId.output` -> context.stepResults.stepId
 * - `steps.stepId.output.path.to.prop` -> nested prop access
 */
export function resolveVariablePath(pathStr: string, context: WorkflowExecutionContext): unknown {
  const parts = pathStr.split(".").map((p) => p.trim());
  if (parts.length === 0 || !parts[0]) {
    throw new WorkflowError(`Invalid template variable path: '${pathStr}'`, "VALIDATION_ERROR", context.workflowId);
  }

  const root = parts[0];
  const subPath = parts.slice(1);

  if (root === "vars") {
    if (subPath.length === 0) return context.variables;
    return getNestedProperty(context.variables, subPath, context.workflowId);
  }

  if (root === "steps") {
    if (subPath.length === 0) return context.stepResults;
    const stepId = subPath[0];
    const stepResult = context.stepResults[stepId];

    if (subPath.length === 1) {
      return stepResult;
    }

    const restPath = subPath.slice(1);
    if (restPath[0] === "output") {
      if (restPath.length === 1) {
        return stepResult;
      }
      return getNestedProperty(stepResult, restPath.slice(1), context.workflowId);
    }

    return getNestedProperty(stepResult, restPath, context.workflowId);
  }

  throw new WorkflowError(`Unknown variable namespace '${root}' in '${pathStr}'. Expected 'vars' or 'steps'.`, "VALIDATION_ERROR", context.workflowId);
}

/**
 * Interpolates a string, replacing {{ vars.x }} or {{ steps.id.output }} with resolved values.
 */
export function interpolateString(inputStr: string, context: WorkflowExecutionContext): unknown {
  // Check if string is EXACTLY a single template expression e.g. "{{ steps.step1.output }}"
  const trimmed = inputStr.trim();
  const exactMatch = /^\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}$/.exec(trimmed);

  if (exactMatch) {
    const varPath = exactMatch[1];
    const resolved = resolveVariablePath(varPath, context);
    if (resolved === undefined) {
      throw new WorkflowError(`Could not resolve variable path '${varPath}' in context.`, "VALIDATION_ERROR", context.workflowId);
    }
    return resolved;
  }

  // Mixed string template e.g. "https://api.example.com/{{ vars.userId }}/details"
  return inputStr.replace(TEMPLATE_REGEX, (_, varPath) => {
    const resolved = resolveVariablePath(varPath, context);
    if (resolved === undefined) {
      throw new WorkflowError(`Could not resolve variable path '${varPath}' in context.`, "VALIDATION_ERROR", context.workflowId);
    }
    if (typeof resolved === "object" && resolved !== null) {
      return JSON.stringify(resolved);
    }
    return String(resolved);
  });
}

/**
 * Recursively interpolates any data structure (strings, arrays, objects) without mutating the original input.
 */
export function interpolateValue<T>(value: T, context: WorkflowExecutionContext): T {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return interpolateString(value, context) as unknown as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolateValue(item, context)) as unknown as T;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const interpolated: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(obj)) {
      if (UNSAFE_PROPERTIES.has(key)) {
        throw new WorkflowError(`Security violation: unsafe object key '${key}' detected.`, "VALIDATION_ERROR", context.workflowId);
      }
      interpolated[key] = interpolateValue(val, context);
    }

    return interpolated as T;
  }

  return value;
}
