import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { AgentDefinition } from "../agents/types";

export interface AgentPromptFile {
  dir: string;
  filePath: string;
}

export async function writeAgentPromptFile(agent: AgentDefinition): Promise<AgentPromptFile> {
  const dir = await mkdtemp(join(tmpdir(), "pi-agent-"));
  const filePath = join(dir, `${safePromptFileName(agent.name)}-system-prompt.md`);
  await withFileMutationQueue(filePath, async () => {
    await writeFile(filePath, agent.systemPrompt || agent.description, { encoding: "utf8", mode: 0o600 });
  });
  return { dir, filePath };
}

function safePromptFileName(agentName: string): string {
  return agentName.replace(/[^a-zA-Z0-9_.-]+/g, "_");
}
