import { sortAgentsContextFiles } from "./ordering";
import type { AgentsContextFile } from "./types";

export function formatAgentsContext(files: AgentsContextFile[]): string {
  const lines = [
    "# Nested Agent Instructions",
    "These instructions became applicable after the agent touched files under their directories. Treat them as additional project instructions. More specific files appear later and take precedence when instructions conflict.",
  ];

  for (const file of sortAgentsContextFiles(files)) {
    lines.push("", `## Scope: ${contextScope(file.relativePath)}`, "", file.content || "[Empty context file]");
  }

  return lines.join("\n");
}

function contextScope(relativePath: string): string {
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.length <= 1) return ".";
  return segments.slice(0, -1).join("/");
}

export function formatLoadedNotification(files: AgentsContextFile[]): string {
  const paths = files.map((file) => file.relativePath).join(", ");
  return `Loaded nested agent context: ${paths}`;
}
