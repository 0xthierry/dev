import { type AgentFeedbackPath, buildAgentFeedbackPath } from "./paths";
import { type AppendAgentFeedbackEntryRequest, appendAgentFeedbackEntry } from "./storage";

export interface AgentFeedbackRuntime {
  now: () => Date;
  buildPath: (cwd: string) => AgentFeedbackPath;
  appendEntry: (request: AppendAgentFeedbackEntryRequest) => Promise<void>;
}

export function createAgentFeedbackRuntime(homeDir?: string): AgentFeedbackRuntime {
  return {
    now: () => new Date(),
    buildPath: (cwd) => buildAgentFeedbackPath(cwd, homeDir),
    appendEntry: appendAgentFeedbackEntry,
  };
}
