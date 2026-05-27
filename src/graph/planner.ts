import { z } from "zod";
import { chat, type ChatMessage } from "@llm/client.js";
import { GenerationPresets } from "@config/models.js";
import { createLogger } from "@utils/logger.js";

const log = createLogger("graph/planner");

const PlannedToolSchema = z.object({
  id: z.string().min(1),
  params: z.record(z.any()).default({}),
});

const BLOCKED_PLANNER_TOOL_IDS = new Set(["shell.execute", "shell.execute_dangerous"]);

export const PlannerSchema = z.object({
  reply: z.string().default(""),
  tools: z.array(PlannedToolSchema).default([]),
  reasoning: z.string().default(""),
});

export type PlannedTool = z.infer<typeof PlannedToolSchema>;
export type PlannerResult = z.infer<typeof PlannerSchema>;

export async function planLaptopTask(args: {
  input: string;
  contextBlock: string;
  selectedModel: string;
  availableTools: string[];
}): Promise<PlannerResult> {
  console.log("[TIMING] llm started", { operation: "planner", input: args.input });
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You are a laptop task planner. Output JSON only.
You may choose tools only when the task is complex or multi-step.
Do not use tools for simple app launches, browser opens, downloads, or volume changes.
Return: {"reply":"<short answer>","tools":[{"id":"<tool_id>","params":{}}],"reasoning":"<short reason>"}

Available tools:
${args.availableTools.map((t) => `- ${t}`).join("\n")}

Context:
${args.contextBlock}`,
    },
    { role: "user", content: args.input },
  ];

  const response = await chat({
    model: args.selectedModel,
    messages,
    options: GenerationPresets.precise,
  });
  console.log("[TIMING] llm finished", { operation: "planner" });

  const parsed = parsePlannerResponse(response);
  const sanitizedTools = sanitizePlannedTools(parsed.tools);
  const sanitized: PlannerResult = {
    ...parsed,
    tools: sanitizedTools,
  };
  log.info("Planner output", { tools: sanitized.tools.length, reasoning: sanitized.reasoning.slice(0, 120) });
  return sanitized;
}

function parsePlannerResponse(response: string): PlannerResult {
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return PlannerSchema.parse(JSON.parse(jsonMatch[0]));
    } catch {
      // fall through
    }
  }

  return {
    reply: response.trim(),
    tools: [],
    reasoning: "unstructured_response",
  };
}

function sanitizePlannedTools(tools: PlannerResult["tools"]): PlannerResult["tools"] {
  const sanitized: PlannerResult["tools"] = [];
  for (const tool of tools ?? []) {
    if (!tool?.id) continue;
    console.log("[PLANNER TOOL]", tool.id, tool.params ?? {});
    if (BLOCKED_PLANNER_TOOL_IDS.has(tool.id)) {
      console.log("[SHELL EXECUTION BLOCKED]", "src/graph/planner.ts", tool.id, tool.params ?? {});
      continue;
    }
    sanitized.push(tool);
  }
  return sanitized;
}
