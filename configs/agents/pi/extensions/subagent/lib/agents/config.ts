import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type PiThinkingLevel, parsePiThinkingLevel } from "../thinking";
import type { AgentDefinition, AgentModelSelection } from "./types";

export const SUBAGENT_CONFIG_FILE_NAME = "pi-subagent.json";

export interface AgentExecutionOverride {
  model?: AgentModelSelection;
  effort?: PiThinkingLevel;
  allowEffortOverride?: boolean;
}

export interface AgentOverrideConfig {
  filePath: string;
  agents: ReadonlyMap<string, AgentExecutionOverride>;
}

export async function loadAgentOverrideConfig(projectRoot: string): Promise<AgentOverrideConfig | undefined> {
  const filePath = resolve(projectRoot, SUBAGENT_CONFIG_FILE_NAME);
  let source: string;
  try {
    source = await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw new Error(`Could not read ${filePath}: ${errorMessage(error)}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new Error(`Could not parse ${filePath}: ${errorMessage(error)}`);
  }

  return normalizeAgentOverrideConfig(value, filePath);
}

export function normalizeAgentOverrideConfig(value: unknown, filePath: string): AgentOverrideConfig {
  const config = requireRecord(value, filePath);
  rejectUnknownFields(config, ["agents"], filePath);
  const rawAgents = requireRecord(config.agents, `${filePath}.agents`);
  const agents = new Map<string, AgentExecutionOverride>();

  for (const [agentName, rawOverride] of Object.entries(rawAgents)) {
    if (!agentName || agentName.trim() !== agentName) {
      throw new Error(`${filePath}.agents keys must be non-empty agent names without surrounding whitespace.`);
    }
    agents.set(agentName, normalizeAgentOverride(rawOverride, `${filePath}.agents.${agentName}`));
  }

  return { filePath, agents };
}

export function applyAgentOverrideConfig(agents: AgentDefinition[], config: AgentOverrideConfig): AgentDefinition[] {
  const availableNames = new Set(agents.map((agent) => agent.name));
  const unknownNames = [...config.agents.keys()].filter((name) => !availableNames.has(name)).sort();
  if (unknownNames.length > 0) {
    // Overrides can name agents that only exist on some branches/worktrees;
    // skip the unmatched entries instead of failing every override.
    console.warn(`${config.filePath} overrides subagents not discovered here (skipped): ${unknownNames.join(", ")}.`);
  }

  return agents.map((agent) => {
    const override = config.agents.get(agent.name);
    if (!override) return agent;
    return {
      ...agent,
      ...(override.model ? { model: { ...override.model } } : {}),
      ...(override.effort ? { effort: override.effort } : {}),
      ...(override.allowEffortOverride !== undefined ? { allowEffortOverride: override.allowEffortOverride } : {}),
    };
  });
}

function normalizeAgentOverride(value: unknown, label: string): AgentExecutionOverride {
  const override = requireRecord(value, label);
  rejectUnknownFields(override, ["provider", "model", "effort", "allowEffortOverride"], label);

  const hasProvider = override.provider !== undefined;
  const hasModel = override.model !== undefined;
  if (hasProvider !== hasModel) {
    throw new Error(`${label}.provider and ${label}.model must be provided together.`);
  }

  const model = hasProvider
    ? {
        provider: requireNonEmptyString(override.provider, `${label}.provider`),
        id: requireNonEmptyString(override.model, `${label}.model`),
      }
    : undefined;

  const effort = override.effort === undefined ? undefined : parsePiThinkingLevel(override.effort);
  if (override.effort !== undefined && !effort) {
    throw new Error(`${label}.effort must be one of: off, minimal, low, medium, high, xhigh, max.`);
  }

  const allowEffortOverride = optionalBoolean(override.allowEffortOverride, `${label}.allowEffortOverride`);
  if (allowEffortOverride === false && !effort) {
    throw new Error(`${label}.effort is required when ${label}.allowEffortOverride is false.`);
  }
  if (!model && !effort) {
    throw new Error(`${label} must define provider + model, effort, or both.`);
  }

  return {
    ...(model ? { model } : {}),
    ...(effort ? { effort } : {}),
    ...(allowEffortOverride !== undefined ? { allowEffortOverride } : {}),
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  if (value !== value.trim()) throw new Error(`${label} must not contain surrounding whitespace.`);
  return value;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean.`);
  return value;
}

function rejectUnknownFields(value: Record<string, unknown>, allowed: string[], label: string): void {
  const allowedFields = new Set(allowed);
  const unknown = Object.keys(value)
    .filter((key) => !allowedFields.has(key))
    .sort();
  if (unknown.length > 0) throw new Error(`${label} contains unknown fields: ${unknown.join(", ")}.`);
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}
