import { type AgentDiscoveryOptions, discoverAgents as discoverConfiguredAgents } from "./agents/discovery";
import type { AgentDefinition, AgentDiscoveryResult } from "./agents/types";
import { type AgentProgressCallback, runChildPiAgent } from "./runner/child-pi";
import type { AgentRunRequest } from "./runner/invocation";
import type { AgentRunResult } from "./runner/run-result";

export interface SubagentRuntime {
  discoverAgents: (options?: AgentDiscoveryOptions) => Promise<AgentDiscoveryResult>;
  runAgent: (
    request: AgentRunRequest,
    signal: AbortSignal | undefined,
    onProgress?: AgentProgressCallback,
  ) => Promise<AgentRunResult>;
}

export function createSubagentRuntime(): SubagentRuntime {
  return {
    discoverAgents: (options) => discoverConfiguredAgents(options),
    runAgent: runChildPiAgent,
  };
}

export function findAgent(agents: AgentDefinition[], name: string): AgentDefinition | undefined {
  return agents.find((agent) => agent.name === name);
}
