import { type AgentFeedbackPath, buildAgentFeedbackPath } from "./paths";
import { type AppendAgentFeedbackEntryRequest, appendAgentFeedbackEntry } from "./storage";

export interface AgentFeedbackRuntime {
  buildPath: (cwd: string) => AgentFeedbackPath;
  appendEntry: (request: AppendAgentFeedbackEntryRequest) => Promise<void>;
}

export function createAgentFeedbackRuntime(): AgentFeedbackRuntime {
  return {
    buildPath: buildAgentFeedbackPath,
    appendEntry: appendAgentFeedbackEntry,
  };
}
