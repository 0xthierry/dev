import { discoverAgentsContextForTarget, discoverAgentsSession } from "./discovery";
import type { AgentsContextDiscovery, AgentsPathTarget, AgentsSession } from "./types";

export interface AgentsRuntime {
  createSession(cwd: string): Promise<AgentsSession>;
  discoverForTarget(session: AgentsSession, cwd: string, target: AgentsPathTarget): Promise<AgentsContextDiscovery>;
}

export function createAgentsRuntime(): AgentsRuntime {
  return {
    createSession: discoverAgentsSession,
    discoverForTarget: discoverAgentsContextForTarget,
  };
}
