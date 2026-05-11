import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

const FEEDBACK_FILE_NAME = "agent_feedback.md";

export interface AgentFeedbackPath {
  filePath: string;
  displayPath: string;
  projectKey: string;
}

export function buildAgentFeedbackPath(cwd: string, homeDir = homedir()): AgentFeedbackPath {
  const projectSegments = projectCwdSegments(cwd);
  const projectKey = projectSegments.join("/");

  return {
    filePath: join(homeDir, ".pi", "agent", "feedback", ...projectSegments, FEEDBACK_FILE_NAME),
    displayPath: join("~", ".pi", "agent", "feedback", ...projectSegments, FEEDBACK_FILE_NAME),
    projectKey,
  };
}

export function projectCwdSegments(cwd: string): string[] {
  const absoluteCwd = resolve(cwd);
  const segments = absoluteCwd.split(sep).filter(Boolean);
  return segments.length > 0 ? segments : ["_root"];
}
