import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type AgentFeedbackRuntime, createAgentFeedbackRuntime } from "./runtime";
import { registerAgentFeedbackTool } from "./tool";

export function registerAgentFeedbackExtension(pi: ExtensionAPI): void {
  registerAgentFeedback(pi, createAgentFeedbackRuntime());
}

export function registerAgentFeedback(pi: ExtensionAPI, runtime: AgentFeedbackRuntime): void {
  registerAgentFeedbackTool(pi, runtime);
}
