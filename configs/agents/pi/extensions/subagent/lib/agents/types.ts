import type { PiThinkingLevel } from "../thinking";

export type AgentSource = "user" | "builtin";

export interface AgentModelSelection {
  provider: string;
  id: string;
}

export interface AgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  filePath: string;
  source: AgentSource;
  frontmatter: Record<string, unknown>;
  model?: AgentModelSelection;
  effort?: PiThinkingLevel;
  allowEffortOverride?: boolean;
}

export interface AgentDiscoveryResult {
  agentsDir: string;
  agentDirs: string[];
  agents: AgentDefinition[];
}
