const MEANINGFUL_PROGRESS_TOOLS = new Set([
  "read",
  "grep",
  "find",
  "multi_grep",
  "ls",
  "bash",
  "edit",
  "write",
  "lsp_diagnostics",
  "lsp_fix",
  "update_goal",
  "create_goal",
]);

const READ_ONLY_TOOLS = new Set(["get_goal", "read", "grep", "find", "multi_grep", "ls", "lsp_diagnostics"]);
const MUTATING_TOOLS = new Set(["bash", "edit", "write", "lsp_fix"]);
const FILE_MUTATION_TOOLS = new Set(["edit", "write", "lsp_fix"]);
const SUBSTANTIVE_PROGRESS_TOOLS = new Set(["agent", "agent_feedback"]);
const READ_ONLY_BASH_PREFIXES =
  /^(?:pwd|ls|cat|head|tail|grep|rg|find|fd|sed\s+-n|awk|git\s+(?:status|diff|log|show|branch|rev-parse)|bun\s+(?:test|run\s+(?:lint|typecheck|test))|npm\s+(?:test|run\s+(?:lint|typecheck|test))|pnpm\s+(?:test|run\s+(?:lint|typecheck|test))|yarn\s+(?:test|run\s+(?:lint|typecheck|test))|bash\s+-n|shellcheck)\b/;

export function isMeaningfulProgressToolCall(toolName: string, input: unknown): boolean {
  if (!MEANINGFUL_PROGRESS_TOOLS.has(toolName)) return false;
  const record = asRecord(input);
  if (toolName === "read") {
    const path = typeof record?.path === "string" ? record.path : "";
    if (path === ".pi/goals" || path.startsWith(".pi/goals/")) return false;
  }
  if (toolName === "bash") {
    const command = typeof record?.command === "string" ? record.command : "";
    if (/^\s*echo\b/.test(command)) return false;
  }
  return true;
}

export function isSubstantiveProgressToolCall(toolName: string, input: unknown): boolean {
  if (FILE_MUTATION_TOOLS.has(toolName)) return isMeaningfulProgressToolCall(toolName, input);
  if (SUBSTANTIVE_PROGRESS_TOOLS.has(toolName)) return true;
  if (toolName === "bash") return isStateChangingBash(input);
  if (toolName === "excalidraw_canvas") return isStateChangingExcalidrawAction(input);
  return false;
}

export function shouldBlockAfterStop(toolName: string): boolean {
  if (READ_ONLY_TOOLS.has(toolName)) return false;
  if (MUTATING_TOOLS.has(toolName)) return true;
  return toolName !== "get_goal";
}

function isStateChangingBash(input: unknown): boolean {
  const record = asRecord(input);
  const command = typeof record?.command === "string" ? record.command.trim() : "";
  if (!command || /^echo\b/.test(command)) return false;
  return !READ_ONLY_BASH_PREFIXES.test(command);
}

function isStateChangingExcalidrawAction(input: unknown): boolean {
  const record = asRecord(input);
  return record?.action === "update_scene" || record?.action === "add_elements" || record?.action === "add_files";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
