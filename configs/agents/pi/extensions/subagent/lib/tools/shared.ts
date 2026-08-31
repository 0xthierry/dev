import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ArtifactPage, ReadArtifactPageOptions, ReadArtifactPageResult } from "../artifacts/artifacts";
import { prepareAggregatePreview, prepareArtifactPageForModel } from "../artifacts/output";
import type { ResolvedAgentExecution } from "../execution/profile";
import { readModelReference } from "../execution/profile";
import { RegistryError } from "../supervisor/registry";
import type { AgentSupervisor } from "../supervisor/supervisor";
import { SupervisorError } from "../supervisor/supervisor";
import type { ExecutionInput } from "./schemas";

export interface AgentToolsRuntime {
  supervisor: AgentSupervisor;
  readArtifactPage(reference: string, options: ReadArtifactPageOptions): Promise<ReadArtifactPageResult>;
  resolveExecution(
    input: ExecutionInput | undefined,
    options: {
      operation: "spawn" | "followup";
      agentType?: string;
      target?: string;
      ctx: ExtensionContext;
    },
  ): Promise<ResolvedAgentExecution>;
}

export interface AgentToolError {
  kind: string;
  message: string;
}

export interface AgentToolDetails<T> {
  ok: boolean;
  operation: string;
  result?: T;
  error?: AgentToolError;
}

export function successResult<T>(operation: string, result: T): AgentToolResult<AgentToolDetails<T>> {
  const rendered = prepareAggregatePreview(JSON.stringify(result, null, 2));
  return {
    content: [{ type: "text", text: rendered.text }],
    details: { ok: true, operation, result },
  };
}

export function artifactPageSuccessResult(
  operation: string,
  page: ArtifactPage,
): AgentToolResult<AgentToolDetails<ArtifactPage>> {
  const prepared = prepareArtifactPageForModel(page);
  return {
    content: [{ type: "text", text: prepared.text }],
    details: { ok: true, operation, result: prepared.page },
  };
}

export function failureResult<T = never>(operation: string, error: unknown): AgentToolResult<AgentToolDetails<T>> {
  const formatted = formatToolError(error);
  return {
    content: [{ type: "text", text: `${operation} failed: ${formatted.message}` }],
    details: { ok: false, operation, error: formatted },
  };
}

export async function toolBoundary<T>(
  operation: string,
  run: () => Promise<T>,
): Promise<AgentToolResult<AgentToolDetails<T>>> {
  try {
    return successResult(operation, await run());
  } catch (error) {
    return failureResult(operation, error);
  }
}

export function assertAtomicExecution(input: ExecutionInput | undefined): void {
  if (!input) return;
  const model = readModelReference({
    provider: "provider" in input ? input.provider : undefined,
    model: "model" in input ? input.model : undefined,
  });
  if (!model.ok)
    throw new ToolInputError("incomplete_model_reference", "provider and model must be specified together");
}

export class ToolInputError extends Error {
  constructor(
    readonly kind: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolInputError";
  }
}

function formatToolError(error: unknown): AgentToolError {
  if (error instanceof ToolInputError || error instanceof SupervisorError || error instanceof RegistryError) {
    return { kind: error.kind, message: boundedMessage(error.message) };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { kind: "aborted", message: "Operation aborted" };
  }
  if (error instanceof Error)
    return { kind: "unexpected", message: boundedMessage(error.message || "Unexpected error") };
  return { kind: "unexpected", message: "Unexpected error" };
}

function boundedMessage(message: string): string {
  return prepareAggregatePreview(message).text;
}
