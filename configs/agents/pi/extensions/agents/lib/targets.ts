import type { AgentsPathTarget, AgentsPathTargetKind } from "./types";

export function extractAgentsPathTargets(toolName: string, input: unknown): AgentsPathTarget[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const value = input as Record<string, unknown>;

  switch (toolName) {
    case "read":
    case "edit":
    case "write":
      return pathTargets(value.path, "file");
    case "grep":
      return pathTargets(value.path, "unknown");
    case "find":
    case "ls":
      return pathTargets(value.path, "directory");
    default:
      return [
        ...pathTargets(value.path, "unknown"),
        ...pathTargets(value.file_path, "file"),
        ...pathTargets(value.cwd, "directory"),
        ...pathTargets(value.directory, "directory"),
      ];
  }
}

function pathTargets(value: unknown, kind: AgentsPathTargetKind): AgentsPathTarget[] {
  return stringValues(value)
    .map((path) => path.trim())
    .filter((path) => path.length > 0)
    .map((path) => ({ path, kind }));
}

function stringValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
