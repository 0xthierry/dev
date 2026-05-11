import type { PiThinkingLevel } from "../thinking";

export type AgentSource = "user" | "builtin";

export interface AgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  filePath: string;
  source: AgentSource;
  frontmatter: Record<string, unknown>;
  effort?: PiThinkingLevel;
}

export interface AgentDiscoveryResult {
  agentsDir: string;
  agents: AgentDefinition[];
}
