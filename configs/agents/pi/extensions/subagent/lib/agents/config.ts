import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PartialAgentExecution } from "../execution/profile";
import { parseReasoningEffort, REASONING_EFFORTS } from "../execution/profile";
import type { RepositoryExecutionPolicy } from "../execution/resolution";

export const SUBAGENT_CONFIG_FILE_NAME = "pi-subagent.json";

export interface InvocationOverridePolicy {
  model: boolean;
  effort: boolean;
}

export interface RepositoryAgentPolicy {
  execution?: PartialAgentExecution;
  allowInvocationOverride: InvocationOverridePolicy;
}

export interface RepositoryRuntimeConfig {
  maxActiveAgents: number;
  maxResidentAgents: number;
  maxDepth: number;
}

export interface RepositorySubagentConfig {
  agents: ReadonlyMap<string, RepositoryAgentPolicy>;
  runtime?: RepositoryRuntimeConfig;
}

export function executionPolicyForAgent(
  config: RepositorySubagentConfig | undefined,
  agentName: string,
): RepositoryExecutionPolicy | undefined {
  const policy = config?.agents.get(agentName);
  if (!policy) return undefined;
  return { ...policy.execution, allowInvocationOverride: { ...policy.allowInvocationOverride } };
}

export class SubagentConfigError extends Error {
  readonly kind = "invalid_repository_config" as const;
  readonly configPath: string;

  constructor(configPath: string, message: string) {
    super(`${configPath}: ${message}`);
    this.name = "SubagentConfigError";
    this.configPath = configPath;
  }
}

export async function loadRepositorySubagentConfig(
  projectRoot: string,
  trusted: boolean,
): Promise<RepositorySubagentConfig | undefined> {
  if (!trusted) return undefined;
  const configPath = resolve(projectRoot, SUBAGENT_CONFIG_FILE_NAME);
  let text: string;
  try {
    text = await readFile(configPath, "utf8");
  } catch (error) {
    if (isMissing(error)) return undefined;
    if (error instanceof SubagentConfigError) throw error;
    throw new SubagentConfigError(SUBAGENT_CONFIG_FILE_NAME, `could not read config: ${message(error)}`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new SubagentConfigError(SUBAGENT_CONFIG_FILE_NAME, `invalid JSON: ${message(error)}`);
  }
  return parseRepositorySubagentConfig(value, SUBAGENT_CONFIG_FILE_NAME);
}

export function parseRepositorySubagentConfig(
  value: unknown,
  configPath = SUBAGENT_CONFIG_FILE_NAME,
): RepositorySubagentConfig {
  const root = record(value, configPath, "config must be an object");
  const rawAgents = root.agents === undefined ? {} : record(root.agents, configPath, "agents must be an object");
  const agentNames = Object.keys(rawAgents).sort();
  const agents = new Map<string, RepositoryAgentPolicy>();
  for (const name of agentNames) {
    if (!exactString(name)) {
      throw new SubagentConfigError(configPath, "agent names must be non-empty and have no surrounding whitespace");
    }
    agents.set(name, parseAgentPolicy(rawAgents[name], configPath, name));
  }
  const runtime = root.runtime === undefined ? undefined : parseRuntime(root.runtime, configPath);
  return { agents, ...(runtime ? { runtime } : {}) };
}

function parseAgentPolicy(value: unknown, path: string, name: string): RepositoryAgentPolicy {
  const label = `agents.${name}`;
  const policy = record(value, path, `${label} must be an object`);
  const nestedExecution =
    policy.execution === undefined ? {} : record(policy.execution, path, `${label}.execution must be an object`);
  const executionFields = {
    ...(policy.provider !== undefined ? { provider: policy.provider } : {}),
    ...(policy.model !== undefined ? { model: policy.model } : {}),
    ...(policy.effort !== undefined ? { effort: policy.effort } : {}),
    ...nestedExecution,
  };
  const execution =
    Object.keys(executionFields).length === 0 ? undefined : parseExecution(executionFields, path, `${label}.execution`);
  const override =
    policy.allowInvocationOverride === undefined
      ? {}
      : record(policy.allowInvocationOverride, path, `${label}.allowInvocationOverride must be an object`);
  const model = optionalBoolean(override.model, path, `${label}.allowInvocationOverride.model`) ?? true;
  const effort = optionalBoolean(override.effort, path, `${label}.allowInvocationOverride.effort`) ?? true;
  if (!model && !execution?.provider)
    throw new SubagentConfigError(
      path,
      `${label}.execution provider and model are required when model overrides are locked`,
    );
  if (!effort && !execution?.effort)
    throw new SubagentConfigError(path, `${label}.execution.effort is required when effort overrides are locked`);
  return { ...(execution ? { execution } : {}), allowInvocationOverride: { model, effort } };
}

function parseExecution(value: unknown, path: string, label: string): PartialAgentExecution {
  const execution = record(value, path, `${label} must be an object`);
  const hasProvider = execution.provider !== undefined;
  const hasModel = execution.model !== undefined;
  if (hasProvider !== hasModel)
    throw new SubagentConfigError(path, `${label}.provider and ${label}.model must be specified together`);
  const provider = hasProvider ? requiredString(execution.provider, path, `${label}.provider`) : undefined;
  const model = hasModel ? requiredString(execution.model, path, `${label}.model`) : undefined;
  const effort = execution.effort === undefined ? undefined : parseReasoningEffort(execution.effort);
  if (execution.effort !== undefined && !effort) {
    throw new SubagentConfigError(path, `${label}.effort must be one of: ${REASONING_EFFORTS.join(", ")}`);
  }
  if (!provider && !effort) throw new SubagentConfigError(path, `${label} must not be empty`);
  return { ...(provider ? { provider, model } : {}), ...(effort ? { effort } : {}) };
}

function parseRuntime(value: unknown, path: string): RepositoryRuntimeConfig {
  const runtime = record(value, path, "runtime must be an object");
  const parsed = {
    maxActiveAgents: positiveInteger(runtime.maxActiveAgents, path, "runtime.maxActiveAgents"),
    maxResidentAgents: positiveInteger(runtime.maxResidentAgents, path, "runtime.maxResidentAgents"),
    maxDepth: positiveInteger(runtime.maxDepth, path, "runtime.maxDepth"),
  };
  if (parsed.maxActiveAgents > parsed.maxResidentAgents) {
    throw new SubagentConfigError(path, "runtime.maxActiveAgents must not exceed runtime.maxResidentAgents");
  }
  return parsed;
}

function record(value: unknown, path: string, error: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SubagentConfigError(path, error);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, path: string, label: string): string {
  if (!exactString(value))
    throw new SubagentConfigError(path, `${label} must be a non-empty string without surrounding whitespace`);
  return value;
}

function exactString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function optionalBoolean(value: unknown, path: string, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new SubagentConfigError(path, `${label} must be a boolean`);
  return value;
}

function positiveInteger(value: unknown, path: string, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new SubagentConfigError(path, `${label} must be a safe integer of at least 1`);
  }
  return value as number;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
