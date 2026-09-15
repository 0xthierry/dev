import type { ExecutionResolutionError, ExecutionResult } from "./errors";
import type {
  AgentExecutionProfile,
  AgentModelReference,
  ExecutionSource,
  PartialAgentExecution,
  ReasoningEffort,
  ResolvedAgentExecution,
} from "./profile";
import { modelPolicyEffort, readModelReference } from "./profile";

export interface InvocationOverride extends PartialAgentExecution {}

export interface RepositoryExecutionPolicy extends PartialAgentExecution {
  allowInvocationOverride?: { model?: boolean; effort?: boolean };
}

export interface ExecutionResolutionInput {
  invocation?: InvocationOverride;
  repository?: RepositoryExecutionPolicy;
  agent?: PartialAgentExecution;
  parent: AgentExecutionProfile;
}

export interface CatalogModel {
  provider: string;
  model: string;
  supportedEfforts: readonly ReasoningEffort[];
}

export interface ModelCatalog {
  hasProvider(provider: string): boolean;
  findModel(provider: string, model: string): CatalogModel | undefined;
  canAuthenticate(provider: string): boolean;
}

export function resolveAgentExecution(input: ExecutionResolutionInput): ExecutionResult<ResolvedAgentExecution> {
  const invocationModel = readModelReference(input.invocation ?? {});
  if (!invocationModel.ok) return invocationModel;
  const repositoryModel = readModelReference(input.repository ?? {});
  if (!repositoryModel.ok) return repositoryModel;
  const agentModel = readModelReference(input.agent ?? {});
  if (!agentModel.ok) return agentModel;

  const modelLockError = lockedModelOverrideError(input, invocationModel.value, repositoryModel.value);
  if (modelLockError) return { ok: false, error: modelLockError };

  const invocationModelSelection =
    invocationModel.value &&
    repositoryModel.value &&
    input.repository?.allowInvocationOverride?.model === false &&
    sameModel(invocationModel.value, repositoryModel.value)
      ? undefined
      : invocationModel.value;
  const selectedModel = firstModel([
    [invocationModelSelection, "invocation"],
    [repositoryModel.value, "repository"],
    [agentModel.value, "agent"],
    [input.parent, "parent"],
  ]);
  const policyEffort = modelPolicyEffort(selectedModel.value);

  if (!policyEffort) {
    const effortLockError = lockedEffortOverrideError(input);
    if (effortLockError) return { ok: false, error: effortLockError };
  }

  const invocationEffortSelection =
    input.invocation?.effort !== undefined &&
    input.repository?.effort !== undefined &&
    input.repository.allowInvocationOverride?.effort === false &&
    input.invocation.effort === input.repository.effort
      ? undefined
      : input.invocation?.effort;
  const selectedEffort = policyEffort
    ? { value: policyEffort, source: "policy" as const }
    : firstEffort([
        [invocationEffortSelection, "invocation"],
        [input.repository?.effort, "repository"],
        [input.agent?.effort, "agent"],
        [input.parent.effort, "parent"],
      ]);

  return {
    ok: true,
    value: {
      profile: { ...selectedModel.value, effort: selectedEffort.value },
      source: { model: selectedModel.source, effort: selectedEffort.source },
    },
  };
}

export function validateAgentExecution(
  execution: ResolvedAgentExecution,
  catalog: ModelCatalog,
): ExecutionResult<ResolvedAgentExecution> {
  const { provider, model, effort } = execution.profile;
  if (!catalog.hasProvider(provider)) return { ok: false, error: { kind: "unknown_provider", provider } };
  const catalogModel = catalog.findModel(provider, model);
  if (!catalogModel) return { ok: false, error: { kind: "unknown_model", provider, model } };
  if (!catalog.canAuthenticate(provider)) {
    return { ok: false, error: { kind: "authentication_unavailable", provider } };
  }
  if (!catalogModel.supportedEfforts.includes(effort)) {
    return {
      ok: false,
      error: {
        kind: "unsupported_effort",
        provider,
        model,
        requested: effort,
        supported: [...catalogModel.supportedEfforts],
      },
    };
  }
  return { ok: true, value: execution };
}

export function resolveAndValidateAgentExecution(
  input: ExecutionResolutionInput,
  catalog: ModelCatalog,
): ExecutionResult<ResolvedAgentExecution> {
  const resolved = resolveAgentExecution(input);
  return resolved.ok ? validateAgentExecution(resolved.value, catalog) : resolved;
}

function lockedModelOverrideError(
  input: ExecutionResolutionInput,
  invocationModel: AgentModelReference | undefined,
  repositoryModel: AgentModelReference | undefined,
): ExecutionResolutionError | undefined {
  const policy = input.repository?.allowInvocationOverride;
  if (invocationModel && repositoryModel && policy?.model === false && !sameModel(invocationModel, repositoryModel)) {
    return {
      kind: "override_locked",
      field: "model",
      requested: `${invocationModel.provider}/${invocationModel.model}`,
      configured: `${repositoryModel.provider}/${repositoryModel.model}`,
    };
  }
  return undefined;
}

function lockedEffortOverrideError(input: ExecutionResolutionInput): ExecutionResolutionError | undefined {
  const invocationEffort = input.invocation?.effort;
  const repositoryEffort = input.repository?.effort;
  if (
    invocationEffort &&
    repositoryEffort &&
    input.repository?.allowInvocationOverride?.effort === false &&
    invocationEffort !== repositoryEffort
  ) {
    return {
      kind: "override_locked",
      field: "effort",
      requested: invocationEffort,
      configured: repositoryEffort,
    };
  }
  return undefined;
}

function sameModel(left: AgentModelReference, right: AgentModelReference): boolean {
  return left.provider === right.provider && left.model === right.model;
}

function firstModel(choices: readonly (readonly [AgentModelReference | undefined, ExecutionSource])[]): {
  value: AgentModelReference;
  source: ExecutionSource;
} {
  for (const [value, source] of choices) if (value) return { value, source };
  throw new Error("parent execution must provide a model");
}

function firstEffort(choices: readonly (readonly [ReasoningEffort | undefined, ExecutionSource])[]): {
  value: ReasoningEffort;
  source: ExecutionSource;
} {
  for (const [value, source] of choices) if (value) return { value, source };
  throw new Error("parent execution must provide an effort");
}
