import { z } from "zod";
import { getToolById } from "@config/tools.js";
import { dispatchTool } from "@tools/dispatcher.js";
import type { ToolResult } from "@tools/toolResult.js";
import { createLogger } from "@utils/logger.js";
import { ToolError } from "@utils/errorHandler.js";

const log = createLogger("graph/toolExecutor");

const schemaCache = new Map<string, z.ZodTypeAny>();

function buildSchema(toolId: string): z.ZodTypeAny {
  const tool = getToolById(toolId);
  if (!tool) return z.record(z.any());
  if (schemaCache.has(toolId)) return schemaCache.get(toolId)!;

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, param] of Object.entries(tool.parameters)) {
    let schema: z.ZodTypeAny;
    switch (param.type) {
      case "number":
        schema = z.number();
        break;
      case "boolean":
        schema = z.boolean();
        break;
      case "array":
        schema = z.array(z.any());
        break;
      case "object":
        schema = z.record(z.any());
        break;
      default:
        schema = z.string();
        break;
    }

    if (param.enum?.length) {
      schema = z.enum([...(param.enum as [string, ...string[]])]);
    }

    if (param.default !== undefined) {
      schema = schema.default(param.default as never);
    } else if (!param.required) {
      schema = schema.optional();
    }

    shape[name] = schema;
  }

  const schema = z.object(shape).strict();
  schemaCache.set(toolId, schema);
  return schema;
}

export interface ValidatedToolCall {
  id: string;
  params: Record<string, unknown>;
}

export async function executeValidatedToolCall(call: ValidatedToolCall) {
  console.log("[TIMING] tool executed", { toolId: call.id });
  if (call.id.startsWith("shell.")) {
    console.log("[SHELL EXECUTION BLOCKED]", "src/graph/toolExecutor.ts", call.id, call.params ?? {});
    throw new Error("SHELL TOOL SHOULD NEVER EXECUTE");
  }
  const tool = getToolById(call.id);
  if (!tool) {
    throw new ToolError(call.id, `Unknown tool: ${call.id}`);
  }

  const schema = buildSchema(call.id);
  const parsed = schema.safeParse(call.params ?? {});
  if (!parsed.success) {
    throw new ToolError(call.id, `Invalid params for ${call.id}`, {
      issues: parsed.error.issues,
      received: call.params,
    });
  }

  const normalized = parsed.data as Record<string, unknown>;
  return await dispatchTool(call.id, normalized);
}

export async function executePlannedTools(toolCalls: ValidatedToolCall[]) {
  const results: Array<{ toolId: string; result: ToolResult; success: boolean; verified: boolean }> = [];
  for (const call of toolCalls) {
    const result = await executeValidatedToolCall(call);
    results.push({
      toolId: call.id,
      result,
      success: result.success === true,
      verified: result.verified === true,
    });
  }
  return results;
}
