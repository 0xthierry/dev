import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { AgentDefinition } from "../agents/types";

export interface AgentPromptFile {
  dir: string;
  filePath: string;
}

const CHILD_AGENT_BOUNDARY_PROMPT = [
  "You are a child subagent, not the parent orchestrator.",
  "The parent session owns decomposition, delegation, synthesis, and final user communication.",
  "Do not propose or run more subagents. Complete the assigned task directly with the tools available in this child session.",
  "If you need to edit files, call the actual edit/write tools instead of printing pseudo tool calls.",
].join("\n");

export async function writeAgentPromptFile(agent: AgentDefinition): Promise<AgentPromptFile> {
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-"));
  const filePath = join(dir, `${safePromptFileName(agent.name)}-system-prompt.md`);
  await withFileMutationQueue(filePath, async () => {
    await writeFile(filePath, buildChildSystemPrompt(agent), { encoding: "utf8", mode: 0o600 });
  });
  return { dir, filePath };
}

function buildChildSystemPrompt(agent: AgentDefinition): string {
  return [CHILD_AGENT_BOUNDARY_PROMPT, agent.systemPrompt || agent.description].join("\n\n");
}

function safePromptFileName(agentName: string): string {
  return agentName.replace(/[^a-zA-Z0-9_.-]+/g, "_");
}
