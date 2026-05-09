import type { AgentsContextFile } from "./types";

export function formatAgentsContext(files: AgentsContextFile[]): string {
  const lines = [
    "# Nested AGENTS.md / CLAUDE.md Context",
    "These context files became applicable after the agent touched files under their directories. Treat them as additional project instructions. More specific files appear later and take precedence when instructions conflict.",
  ];

  for (const file of files) {
    lines.push("", `## ${file.relativePath}`, "", file.content || "[Empty context file]");
  }

  return lines.join("\n");
}

export function formatLoadedNotification(files: AgentsContextFile[]): string {
  const paths = files.map((file) => file.relativePath).join(", ");
  return `Loaded nested agent context: ${paths}`;
}
