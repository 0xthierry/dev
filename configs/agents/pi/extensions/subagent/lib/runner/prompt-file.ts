import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";

export interface AgentPromptDefinition {
  agentPath: string;
  instructions: string;
}

export interface AgentPromptFile {
  directory: string;
  filePath: string;
}

export function buildAgentSystemPrompt(definition: AgentPromptDefinition): string {
  const agentPath = requireSingleLine(definition.agentPath, "agent path");
  const instructions = definition.instructions.trim();
  if (!instructions) throw new Error("Agent instructions must not be empty");

  return [
    `You are subagent ${agentPath}.`,
    "You work for a parent orchestration session.",
    "Use collaboration tools for bounded communication.",
    "Your final answer is delivered to your direct parent.",
    "Do not expose credentials or control-channel metadata.",
    "",
    instructions,
  ].join("\n");
}

export async function writeAgentPromptFile(definition: AgentPromptDefinition): Promise<AgentPromptFile> {
  const directory = await mkdtemp(join(tmpdir(), "pi-subagent-"));
  const fileName = `${safeFileName(definition.agentPath)}-system-prompt.md`;
  const filePath = join(directory, fileName);

  try {
    await withFileMutationQueue(filePath, async () => {
      await writeFile(filePath, buildAgentSystemPrompt(definition), { encoding: "utf8", mode: 0o600 });
    });
    return { directory, filePath };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function removeAgentPromptFile(promptFile: AgentPromptFile): Promise<void> {
  await rm(promptFile.directory, { recursive: true, force: true });
}

function safeFileName(agentPath: string): string {
  const value = basename(agentPath)
    .replace(/[^0-9A-Za-z_.-]+/g, "_")
    .replace(/^\.+$/, "agent");
  return value || "agent";
}

function requireSingleLine(value: string, name: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Agent ${name} must not be empty`);
  if (trimmed.includes("\n") || trimmed.includes("\r")) throw new Error(`Agent ${name} must be one line`);
  return trimmed;
}
