import { type Dirent, existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { delimiter, relative, resolve, sep } from "node:path";
import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { parsePiThinkingLevel } from "../thinking";
import { BUILTIN_AGENTS } from "./builtins";
import type { AgentDefinition, AgentDiscoveryResult } from "./types";

export interface AgentDiscoveryOptions {
  agentsDir?: string;
  cwd?: string;
}

interface AgentFrontmatter extends Record<string, unknown> {
  name?: unknown;
  description?: unknown;
  effort?: unknown;
}

export async function discoverAgents(options: AgentDiscoveryOptions = {}): Promise<AgentDiscoveryResult> {
  const discovery = await discoverUserAgents(options);
  return {
    agentsDir: discovery.agentsDir,
    agentDirs: discovery.agentDirs,
    agents: mergeBuiltInAgents(discovery.agents),
  };
}

export async function discoverUserAgents(options: AgentDiscoveryOptions = {}): Promise<AgentDiscoveryResult> {
  const agentDirs = resolveAgentDirs(options);
  const agentsByName = new Map<string, AgentDefinition>();

  for (const agentsDir of agentDirs) {
    const files = await findMarkdownFiles(agentsDir);
    for (const filePath of files) {
      const agent = await readAgentFile(filePath);
      if (!agent) continue;
      if (!agentsByName.has(agent.name)) agentsByName.set(agent.name, agent);
    }
  }

  return {
    agentsDir: agentDirs.join(delimiter),
    agentDirs,
    agents: sortAgents([...agentsByName.values()]),
  };
}

function resolveAgentDirs(options: AgentDiscoveryOptions): string[] {
  const configuredAgentsDir = options.agentsDir ? resolve(options.agentsDir) : resolve(getAgentDir(), "agents");
  return uniqueDirectories([...projectAgentDirs(options.cwd), configuredAgentsDir]);
}

function projectAgentDirs(cwd: string | undefined): string[] {
  if (!cwd) return [];

  const resolvedCwd = resolve(cwd);
  const projectRoot = findProjectRoot(resolvedCwd);
  return ancestorDirs(projectRoot, resolvedCwd)
    .reverse()
    .map((dir) => resolve(dir, ".pi", "agents"))
    .filter((dir) => existsSync(dir));
}

function uniqueDirectories(dirs: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    const resolved = resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

function findProjectRoot(cwd: string): string {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(resolve(current, ".git"))) return current;
    const parent = resolve(current, "..");
    if (parent === current) return cwd;
    current = parent;
  }
}

function ancestorDirs(root: string, cwd: string): string[] {
  const dirs = [root];
  let current = root;
  while (current !== cwd) {
    const relativeChild = relative(current, cwd).split(sep)[0];
    if (!relativeChild || relativeChild.startsWith("..")) break;
    current = resolve(current, relativeChild);
    dirs.push(current);
  }
  return dirs;
}

function mergeBuiltInAgents(userAgents: AgentDefinition[]): AgentDefinition[] {
  const agentsByName = new Map<string, AgentDefinition>();
  for (const agent of userAgents) agentsByName.set(agent.name, agent);
  for (const agent of BUILTIN_AGENTS) {
    if (!agentsByName.has(agent.name)) agentsByName.set(agent.name, agent);
  }
  return sortAgents([...agentsByName.values()]);
}

function sortAgents(agents: AgentDefinition[]): AgentDefinition[] {
  return agents.sort((a, b) => a.name.localeCompare(b.name));
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
      const path = resolve(directory, entry.name);
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

    const effort = parsePiThinkingLevel(frontmatter.effort);

    return {
      name: frontmatter.name.trim(),
      description: frontmatter.description.trim(),
      systemPrompt: body.trim(),
      filePath,
      source: "user",
      frontmatter,
      ...(effort ? { effort } : {}),
    };
  } catch {
    return undefined;
  }
}
