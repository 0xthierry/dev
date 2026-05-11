import type { AgentDefinition } from "./types";

export function buildAgentPromptSection(agents: AgentDefinition[], agentsDir: string): string {
  if (agents.length === 0) {
    return [
      "## Subagents",
      "The Agent tool is available, but no subagents are configured.",
      `Create Markdown agent definitions with name and description frontmatter under ${agentsDir}.`,
    ].join("\n");
  }

  return [
    "## Subagents",
    "Use the Agent tool to delegate self-contained work to a focused child Pi session.",
    "Each child starts with fresh context by default, loads Pi context files and skills through normal Pi discovery, and returns only its final result.",
    "For independent work, pass multiple entries in Agent.tasks so they can run concurrently.",
    "Prompt children with a compact contract: goal, context/evidence, success criteria, hard constraints, validation, expected output, and stop rules.",
    "Configured agent files override built-in agents with the same name.",
    "Available subagents:",
    ...agents.sort((a, b) => a.name.localeCompare(b.name)).map((agent) => `- ${agent.name}: ${agent.description}`),
  ].join("\n");
}

export function appendAgentPromptSection(systemPrompt: string, section: string): string {
  const trimmedSystem = systemPrompt.trimEnd();
  if (!trimmedSystem) return section;
  return `${trimmedSystem}\n\n${section}`;
}
