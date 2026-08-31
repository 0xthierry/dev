import type { ExecutionResolutionError, ExecutionResult } from "./errors";

export const REASONING_EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface AgentModelReference {
  provider: string;
  model: string;
}

export interface AgentExecutionProfile extends AgentModelReference {
  effort: ReasoningEffort;
}

export interface PartialAgentExecution {
  provider?: string;
  model?: string;
  effort?: ReasoningEffort;
}

export type ExecutionSource = "invocation" | "repository" | "agent" | "parent";

export interface ResolvedAgentExecution {
  profile: AgentExecutionProfile;
  source: { model: ExecutionSource; effort: ExecutionSource };
}

const EFFORT_SET = new Set<string>(REASONING_EFFORTS);

export function parseReasoningEffort(value: unknown): ReasoningEffort | undefined {
  return typeof value === "string" && EFFORT_SET.has(value) ? (value as ReasoningEffort) : undefined;
}

export function readModelReference(value: {
  provider?: unknown;
  model?: unknown;
}): ExecutionResult<AgentModelReference | undefined> {
  const hasProvider = value.provider !== undefined;
  const hasModel = value.model !== undefined;
  if (hasProvider !== hasModel) return { ok: false, error: { kind: "incomplete_model_reference" } };
  if (!hasProvider) return { ok: true, value: undefined };
  if (!isExactNonemptyString(value.provider) || !isExactNonemptyString(value.model)) {
    return { ok: false, error: { kind: "incomplete_model_reference" } };
  }
  return { ok: true, value: { provider: value.provider, model: value.model } };
}

export function assertReasoningEffort(value: unknown, label = "effort"): ReasoningEffort {
  const effort = parseReasoningEffort(value);
  if (!effort) throw new Error(`${label} must be one of: ${REASONING_EFFORTS.join(", ")}.`);
  return effort;
}

export function formatExecutionError(error: ExecutionResolutionError): string {
  switch (error.kind) {
    case "incomplete_model_reference":
      return "provider and model must be specified together";
    case "unknown_provider":
      return `Unknown provider: ${error.provider}`;
    case "unknown_model":
      return `Unknown model: ${error.provider}/${error.model}`;
    case "authentication_unavailable":
      return `Authentication unavailable for provider: ${error.provider}`;
    case "unsupported_effort":
      return `${error.provider}/${error.model} does not support effort ${error.requested}; supported: ${error.supported.join(", ")}`;
    case "override_locked":
      return `${error.field} override is locked (requested ${error.requested}, configured ${error.configured})`;
  }
}

function isExactNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}
