import type { AgentDefinition } from "./types";

const CATALOG_INTRO = [
  "## Subagents",
  "Use the agent tools to delegate self-contained work to a focused child Pi session.",
  "Choose a listed subagent type and provide a compact contract with goal, context, success criteria, constraints, and validation.",
  "Available subagents:",
] as const;

export function buildAgentPromptSection(agents: readonly AgentDefinition[]): string {
  if (agents.length === 0) return "";
  const catalog = [...agents]
    .sort((left, right) => left.name.localeCompare(right.name) || left.description.localeCompare(right.description))
    .map((agent) => `- ${agent.name}: ${singleLine(agent.description)}`);
  return [...CATALOG_INTRO, ...catalog].join("\n");
}

export function appendAgentPromptSection(systemPrompt: string, section: string): string {
  const base = systemPrompt.trimEnd();
  const addition = section.trim();
  if (!addition) return base;
  return base ? `${base}\n\n${addition}` : addition;
}

function singleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
