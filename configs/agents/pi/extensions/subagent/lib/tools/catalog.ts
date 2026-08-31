import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAgentCloseTool } from "./close";
import { registerAgentFollowupTool } from "./followup";
import { registerAgentInterruptTool } from "./interrupt";
import { registerAgentListTool } from "./list";
import { registerAgentSendTool } from "./send";
import type { AgentToolsRuntime } from "./shared";
import { registerAgentSpawnTool } from "./spawn";
import { registerAgentWaitTool } from "./wait";

export const AGENT_TOOL_NAMES = [
  "agent_spawn",
  "agent_send",
  "agent_followup",
  "agent_wait",
  "agent_interrupt",
  "agent_list",
  "agent_close",
] as const;

export function registerAgentTools(pi: ExtensionAPI, runtime: AgentToolsRuntime): void {
  registerAgentSpawnTool(pi, runtime);
  registerAgentSendTool(pi, runtime);
  registerAgentFollowupTool(pi, runtime);
  registerAgentWaitTool(pi, runtime);
  registerAgentInterruptTool(pi, runtime);
  registerAgentListTool(pi, runtime);
  registerAgentCloseTool(pi, runtime);
}
