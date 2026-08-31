import type { PartialAgentExecution } from "../execution/profile";

export type AgentSource = "project" | "global" | "builtin";

export interface AgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  /** Stable display reference. Never an absolute host path. */
  sourcePath: string;
  source: AgentSource;
  execution?: PartialAgentExecution;
}

export interface AgentDiscoveryResult {
  agents: AgentDefinition[];
  repositoryConfig?: import("./config").RepositorySubagentConfig;
}

export class AgentDefinitionError extends Error {
  readonly kind: "malformed_agent" | "duplicate_agent";
  readonly sourcePath: string;
  readonly agentName?: string;

  constructor(kind: AgentDefinitionError["kind"], sourcePath: string, message: string, agentName?: string) {
    super(message);
    this.name = "AgentDefinitionError";
    this.kind = kind;
    this.sourcePath = sourcePath;
    this.agentName = agentName;
  }
}
