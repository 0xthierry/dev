import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, parseFrontmatter } from "@mariozechner/pi-coding-agent";
import type { AgentDefinition, AgentDiscoveryResult } from "./types";

export interface AgentDiscoveryOptions {
  agentsDir?: string;
}

interface AgentFrontmatter extends Record<string, unknown> {
  name?: unknown;
  description?: unknown;
}

export async function discoverUserAgents(options: AgentDiscoveryOptions = {}): Promise<AgentDiscoveryResult> {
  const agentsDir = options.agentsDir ?? join(getAgentDir(), "agents");
  const files = await findMarkdownFiles(agentsDir);
  const agentsByName = new Map<string, AgentDefinition>();

  for (const filePath of files) {
    const agent = await readAgentFile(filePath);
    if (!agent) continue;
    if (!agentsByName.has(agent.name)) agentsByName.set(agent.name, agent);
  }

  return {
    agentsDir,
    agents: [...agentsByName.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function findMarkdownFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(directory: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md")) files.push(path);
    }
  }

  await walk(root);
  return files.sort();
}

async function readAgentFile(filePath: string): Promise<AgentDefinition | undefined> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }

  try {
    const { frontmatter, body } = parseFrontmatter<AgentFrontmatter>(content);
    if (typeof frontmatter.name !== "string" || !frontmatter.name.trim()) return undefined;
    if (typeof frontmatter.description !== "string" || !frontmatter.description.trim()) return undefined;

    return {
      name: frontmatter.name.trim(),
      description: frontmatter.description.trim(),
      systemPrompt: body.trim(),
      filePath,
      source: "user",
      frontmatter,
    };
  } catch {
    return undefined;
  }
}
