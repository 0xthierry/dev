export type AgentSource = "user";

export interface AgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  filePath: string;
  source: AgentSource;
  frontmatter: Record<string, unknown>;
}

export interface AgentDiscoveryResult {
  agentsDir: string;
  agents: AgentDefinition[];
}
