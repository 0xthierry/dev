import { join, resolve } from "node:path";

const FEEDBACK_FILE_NAME = "agent_feedback.md";

export interface AgentFeedbackPath {
  filePath: string;
  displayPath: string;
}

export function buildAgentFeedbackPath(cwd: string): AgentFeedbackPath {
  const absoluteCwd = resolve(cwd);

  return {
    filePath: join(absoluteCwd, FEEDBACK_FILE_NAME),
    displayPath: FEEDBACK_FILE_NAME,
  };
}
