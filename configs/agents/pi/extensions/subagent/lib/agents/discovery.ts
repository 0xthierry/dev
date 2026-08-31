import { type Dirent, existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { BUILTIN_AGENTS } from "./builtins";
import { loadRepositorySubagentConfig, SUBAGENT_CONFIG_FILE_NAME, SubagentConfigError } from "./config";
import { parseDiscoveredAgentMarkdown } from "./frontmatter";
import { type AgentDefinition, AgentDefinitionError, type AgentDiscoveryResult, type AgentSource } from "./types";

export interface AgentDiscoveryOptions {
  cwd?: string;
  projectRoot?: string;
  projectTrusted: boolean;
  globalAgentsDir?: string;
  builtins?: readonly AgentDefinition[];
}

export async function discoverAgents(options: AgentDiscoveryOptions): Promise<AgentDiscoveryResult> {
  const projectRoot = options.projectRoot ?? (options.cwd ? findProjectRoot(options.cwd) : undefined);
  const discovered: AgentDefinition[] = [];
  if (projectRoot && options.projectTrusted) {
    discovered.push(...(await readAgentDirectory(resolve(projectRoot, ".pi", "agents"), "project", projectRoot)));
  }
  if (options.globalAgentsDir) {
    discovered.push(...(await readAgentDirectory(resolve(options.globalAgentsDir), "global")));
  }

  // Sources are ordered by precedence: trusted project, global, then built-in.
  // Duplicates within one source are malformed; a higher-precedence source
  // intentionally overrides the same role from a lower-precedence source.
  const agentsByName = new Map<string, AgentDefinition>();
  for (const agent of discovered) {
    if (!agentsByName.has(agent.name)) agentsByName.set(agent.name, agent);
  }
  for (const builtin of options.builtins ?? BUILTIN_AGENTS) {
    if (!agentsByName.has(builtin.name)) agentsByName.set(builtin.name, cloneAgent(builtin));
  }
  const agents = [...agentsByName.values()].sort(compareAgents);
  const repositoryConfig = projectRoot
    ? await loadRepositorySubagentConfig(projectRoot, options.projectTrusted)
    : undefined;
  if (repositoryConfig) rejectUnknownConfiguredAgents(repositoryConfig.agents.keys(), agents);
  return { agents, ...(repositoryConfig ? { repositoryConfig } : {}) };
}

export async function readAgentDirectory(
  directory: string,
  source: Exclude<AgentSource, "builtin">,
  projectRoot?: string,
): Promise<AgentDefinition[]> {
  const files = await markdownFiles(directory);
  const agents: AgentDefinition[] = [];
  for (const filePath of files) {
    const sourcePath = stableSourcePath(filePath, source, projectRoot, directory);
    let markdown: string;
    try {
      markdown = await readFile(filePath, "utf8");
    } catch {
      throw new AgentDefinitionError("malformed_agent", sourcePath, `${sourcePath}: could not read agent definition`);
    }
    const agent = parseDiscoveredAgentMarkdown(markdown, sourcePath, source);
    if (agent) agents.push(agent);
  }
  rejectDuplicateDefinitions(agents);
  return agents.sort(compareAgents);
}

export function rejectDuplicateDefinitions(agents: readonly AgentDefinition[]): void {
  const firstByName = new Map<string, AgentDefinition>();
  for (const agent of [...agents].sort((left, right) => left.sourcePath.localeCompare(right.sourcePath))) {
    const first = firstByName.get(agent.name);
    if (!first) {
      firstByName.set(agent.name, agent);
      continue;
    }
    throw new AgentDefinitionError(
      "duplicate_agent",
      agent.sourcePath,
      `Duplicate agent '${agent.name}' in ${first.sourcePath} and ${agent.sourcePath}`,
      agent.name,
    );
  }
}

export function findProjectRoot(cwd: string): string {
  const original = resolve(cwd);
  let current = original;
  while (true) {
    if (existsSync(resolve(current, ".git"))) return current;
    const parent = resolve(current, "..");
    if (parent === current) return original;
    current = parent;
  }
}

async function markdownFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(current: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md")) files.push(path);
    }
  }
  await visit(directory);
  return files.sort();
}

function stableSourcePath(
  filePath: string,
  source: "project" | "global",
  projectRoot?: string,
  directory?: string,
): string {
  if (source === "project" && projectRoot) return normalize(relative(projectRoot, filePath));
  const withinGlobal = relative(directory ?? "", filePath);
  return `global://${normalize(withinGlobal)}`;
}

function normalize(path: string): string {
  return path.split(sep).join("/");
}

function compareAgents(left: AgentDefinition, right: AgentDefinition): number {
  return left.name.localeCompare(right.name) || left.sourcePath.localeCompare(right.sourcePath);
}

function cloneAgent(agent: AgentDefinition): AgentDefinition {
  return { ...agent, ...(agent.execution ? { execution: { ...agent.execution } } : {}) };
}

function rejectUnknownConfiguredAgents(names: Iterable<string>, agents: readonly AgentDefinition[]): void {
  const available = new Set(agents.map((agent) => agent.name));
  const unknown = [...names].filter((name) => !available.has(name)).sort();
  if (unknown.length) {
    throw new SubagentConfigError(SUBAGENT_CONFIG_FILE_NAME, `configures unknown agents: ${unknown.join(", ")}`);
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
