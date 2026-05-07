import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendAgentPromptSection, buildAgentPromptSection } from "./agents/prompt";
import { shouldRegisterInCurrentProcess } from "./runner/invocation";
import { createSubagentRuntime, type SubagentRuntime } from "./runtime";
import { registerAgentTool } from "./tools/agent-tool";

export function registerSubagentExtension(pi: ExtensionAPI): void {
  if (!shouldRegisterInCurrentProcess()) return;
  registerSubagentTools(pi, createSubagentRuntime());
}

export function registerSubagentTools(pi: ExtensionAPI, runtime: SubagentRuntime): void {
  registerAgentTool(pi, runtime);

  pi.on("before_agent_start", async (event) => {
    const discovery = await runtime.discoverAgents();
    const section = buildAgentPromptSection(discovery.agents, discovery.agentsDir);
    return { systemPrompt: appendAgentPromptSection(event.systemPrompt, section) };
  });
}
