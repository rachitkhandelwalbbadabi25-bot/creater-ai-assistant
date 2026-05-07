// ════════════════════════════════════════════════════════════════════════════════
// src/config/tools.ts — Tool registry, permission levels, and safety constraints
// ════════════════════════════════════════════════════════════════════════════════

// ─── Permission Levels ────────────────────────────────────────────────────────────
/**
 * SAFE       → Always allowed, no confirmation needed.
 * MODERATE   → Allowed, but logged for audit.
 * SENSITIVE  → Requires user confirmation in strict mode.
 * DANGEROUS  → Always requires explicit confirmation, regardless of safety mode.
 */
export type PermissionLevel = "safe" | "moderate" | "sensitive" | "dangerous";

// ─── Tool Definition ──────────────────────────────────────────────────────────────
export interface ToolDefinition {
  /** Unique machine-readable ID */
  id: string;
  /** Human-readable name shown to user */
  name: string;
  /** What this tool does */
  description: string;
  /** Category for grouping */
  category: ToolCategory;
  /** Safety level — determines if confirmation is required */
  permission: PermissionLevel;
  /** Parameters the tool accepts (JSON Schema style) */
  parameters: Record<string, ToolParameter>;
  /** Example usage for LLM context */
  example?: string;
}

export interface ToolParameter {
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required: boolean;
  enum?: string[];
  default?: unknown;
}

export type ToolCategory =
  | "filesystem"
  | "shell"
  | "browser"
  | "editor"
  | "system"
  | "memory"
  | "external"
  | "voice"
  | "notification";

// ─── Tool Registry ────────────────────────────────────────────────────────────────
export const TOOL_REGISTRY: ToolDefinition[] = [
  // ── File System Tools ────────────────────────────────────────────────────────
  {
    id: "fs.read_file",
    name: "Read File",
    description: "Read the contents of a file at a given path.",
    category: "filesystem",
    permission: "safe",
    parameters: {
      path: { type: "string", description: "Absolute or relative file path", required: true },
      encoding: { type: "string", description: "File encoding", required: false, default: "utf-8" },
    },
    example: 'fs.read_file({ path: "~/projects/app/src/main.ts" })',
  },
  {
    id: "fs.write_file",
    name: "Write File",
    description: "Write or overwrite content to a file.",
    category: "filesystem",
    permission: "sensitive",
    parameters: {
      path: { type: "string", description: "Target file path", required: true },
      content: { type: "string", description: "Content to write", required: true },
      append: { type: "boolean", description: "Append instead of overwrite", required: false, default: false },
    },
  },
  {
    id: "fs.delete_file",
    name: "Delete File",
    description: "Permanently delete a file or directory.",
    category: "filesystem",
    permission: "dangerous",
    parameters: {
      path: { type: "string", description: "Path to delete", required: true },
      recursive: { type: "boolean", description: "Delete directory recursively", required: false, default: false },
    },
  },
  {
    id: "fs.list_directory",
    name: "List Directory",
    description: "List files and folders in a directory.",
    category: "filesystem",
    permission: "safe",
    parameters: {
      path: { type: "string", description: "Directory path", required: true },
      pattern: { type: "string", description: "Glob pattern filter", required: false },
    },
  },

  // ── Shell Tools ──────────────────────────────────────────────────────────────
  {
    id: "shell.execute",
    name: "Execute Shell Command",
    description: "Run a sandboxed shell command. Commands are validated before execution.",
    category: "shell",
    permission: "sensitive",
    parameters: {
      command: { type: "string", description: "Shell command to run", required: true },
      cwd: { type: "string", description: "Working directory", required: false, default: "." },
      timeout_ms: { type: "number", description: "Max execution time in ms", required: false, default: 30000 },
    },
    example: 'shell.execute({ command: "npm run build", cwd: "~/projects/app" })',
  },
  {
    id: "shell.execute_dangerous",
    name: "Execute Dangerous Shell Command",
    description: "Run a potentially destructive shell command (rm, sudo, etc.). Always requires confirmation.",
    category: "shell",
    permission: "dangerous",
    parameters: {
      command: { type: "string", description: "Shell command to run", required: true },
      reason: { type: "string", description: "Why this command is needed", required: true },
    },
  },

  // ── Browser Tools ────────────────────────────────────────────────────────────
  {
    id: "browser.navigate",
    name: "Open URL in Browser",
    description: "Navigate to a URL in a headless browser.",
    category: "browser",
    permission: "safe",
    parameters: {
      url: { type: "string", description: "URL to open", required: true },
    },
  },
  {
    id: "browser.screenshot",
    name: "Take Screenshot",
    description: "Take a screenshot of the current browser page or a URL.",
    category: "browser",
    permission: "safe",
    parameters: {
      url: { type: "string", description: "URL to screenshot (optional, uses current page)", required: false },
      selector: { type: "string", description: "CSS selector to screenshot", required: false },
    },
  },
  {
    id: "browser.extract_text",
    name: "Extract Page Text",
    description: "Extract readable text content from a web page.",
    category: "browser",
    permission: "safe",
    parameters: {
      url: { type: "string", description: "URL to extract text from", required: true },
    },
  },
  {
    id: "browser.fill_form",
    name: "Fill and Submit Form",
    description: "Fill out and submit a web form. Use carefully.",
    category: "browser",
    permission: "sensitive",
    parameters: {
      url: { type: "string", description: "URL containing the form", required: true },
      fields: { type: "object", description: "Map of field selectors to values", required: true },
      submit_selector: { type: "string", description: "CSS selector for submit button", required: false },
    },
  },

  // ── System Tools ─────────────────────────────────────────────────────────────
  {
    id: "system.info",
    name: "Get System Info",
    description: "Get CPU, RAM, battery, disk, and network stats.",
    category: "system",
    permission: "safe",
    parameters: {
      metrics: {
        type: "array",
        description: 'Which metrics to fetch: ["cpu", "ram", "battery", "disk", "network", "processes"]',
        required: false,
      },
    },
  },
  {
    id: "system.notify",
    name: "Send Desktop Notification",
    description: "Show a desktop notification to the user.",
    category: "notification",
    permission: "safe",
    parameters: {
      title: { type: "string", description: "Notification title", required: true },
      message: { type: "string", description: "Notification body", required: true },
      sound: { type: "boolean", description: "Play notification sound", required: false, default: false },
    },
  },

  // ── Editor / Git Tools ───────────────────────────────────────────────────────
  {
    id: "editor.open_file",
    name: "Open File in VS Code",
    description: "Open a file in VS Code editor.",
    category: "editor",
    permission: "safe",
    parameters: {
      path: { type: "string", description: "File path to open", required: true },
      line: { type: "number", description: "Line number to jump to", required: false },
    },
  },
  {
    id: "git.status",
    name: "Git Status",
    description: "Get git status of a repository.",
    category: "editor",
    permission: "safe",
    parameters: {
      repo_path: { type: "string", description: "Path to git repository", required: true },
    },
  },
  {
    id: "git.commit",
    name: "Git Commit",
    description: "Stage all changes and commit with a message.",
    category: "editor",
    permission: "sensitive",
    parameters: {
      repo_path: { type: "string", description: "Path to git repository", required: true },
      message: { type: "string", description: "Commit message", required: true },
    },
  },
];

// ─── Lookup Helpers ───────────────────────────────────────────────────────────────
const toolMap = new Map<string, ToolDefinition>(
  TOOL_REGISTRY.map((t) => [t.id, t])
);

export function getToolById(id: string): ToolDefinition | undefined {
  return toolMap.get(id);
}

export function getToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return TOOL_REGISTRY.filter((t) => t.category === category);
}

export function getToolsByPermission(level: PermissionLevel): ToolDefinition[] {
  return TOOL_REGISTRY.filter((t) => t.permission === level);
}

/**
 * Returns true if the given tool requires user confirmation
 * based on the current safety mode setting.
 */
export function requiresConfirmation(
  tool: ToolDefinition,
  safetyMode: "strict" | "moderate" | "permissive"
): boolean {
  if (tool.permission === "dangerous") return true;
  if (safetyMode === "strict" && tool.permission === "sensitive") return true;
  if (safetyMode === "moderate" && tool.permission === "dangerous") return true;
  return false;
}
