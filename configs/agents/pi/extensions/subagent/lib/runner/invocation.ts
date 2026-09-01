import { basename, delimiter, resolve } from "node:path";
import type { ReasoningEffort } from "../rpc/protocol";

export const CHILD_DEPTH_ENV = "PI_SUBAGENT_DEPTH";
export const CHILD_EXTENSIONS_ENV = "PI_SUBAGENT_CHILD_EXTENSIONS";
export const CHILD_NO_EXTENSIONS_ENV = "PI_SUBAGENT_CHILD_NO_EXTENSIONS";
export const CHILD_UNSET_ENV = "PI_SUBAGENT_CHILD_UNSET_ENV";
const PI_PARENT_MARKER_ENV = "PI_CODING_AGENT";

export interface AgentExecutionSettings {
  provider: string;
  model: string;
  effort: ReasoningEffort;
}

export type AgentSessionInvocation =
  | { kind: "fresh"; sessionDirectory: string }
  | { kind: "fork"; sessionDirectory: string; parentSessionFile: string }
  | { kind: "recovered"; sessionFile: string };

export interface ParentPiRuntime {
  executable: string;
  entrypoint?: string;
}

export interface AgentInvocationRequest {
  cwd: string;
  session: AgentSessionInvocation;
  execution: AgentExecutionSettings;
  childRuntimeExtensionPath: string;
  systemPromptPath: string;
  parentEnvironment?: NodeJS.ProcessEnv;
  /** Test/embedding seam; production detects the current Pi runtime. */
  parentRuntime?: ParentPiRuntime;
}

export interface AgentInvocation {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export type AgentInvocationErrorKind = "invalid_request" | "invalid_parent_runtime";

export class AgentInvocationError extends Error {
  constructor(
    readonly kind: AgentInvocationErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "AgentInvocationError";
  }
}

export function buildAgentInvocation(request: AgentInvocationRequest): AgentInvocation {
  requireNonempty(request.cwd, "cwd");
  requireNonempty(request.execution.provider, "provider");
  requireNonempty(request.execution.model, "model");
  requireNonempty(request.childRuntimeExtensionPath, "child runtime extension path");
  requireNonempty(request.systemPromptPath, "system prompt path");

  const parentEnvironment = request.parentEnvironment ?? process.env;
  const runtime = normalizeParentRuntime(request.parentRuntime ?? detectParentPiRuntime(parentEnvironment));
  const args = [...(runtime.entrypoint ? [runtime.entrypoint] : []), "--mode", "rpc"];
  if (isTruthy(parentEnvironment[CHILD_NO_EXTENSIONS_ENV])) args.push("--no-extensions");
  args.push("-e", resolve(request.childRuntimeExtensionPath));
  for (const extensionPath of parsePathList(parentEnvironment[CHILD_EXTENSIONS_ENV])) {
    args.push("-e", resolve(extensionPath));
  }

  switch (request.session.kind) {
    case "fresh":
      args.push("--session-dir", requireNonempty(request.session.sessionDirectory, "session directory"));
      break;
    case "fork":
      args.push("--session-dir", requireNonempty(request.session.sessionDirectory, "session directory"));
      args.push("--fork", requireNonempty(request.session.parentSessionFile, "parent session file"));
      break;
    case "recovered":
      args.push("--session", requireNonempty(request.session.sessionFile, "recovered session file"));
      break;
  }

  args.push("--model", `${request.execution.provider}/${request.execution.model}`);
  args.push("--thinking", request.execution.effort);
  args.push("--append-system-prompt", resolve(request.systemPromptPath));

  return {
    command: runtime.executable,
    args,
    cwd: request.cwd,
    env: childEnvironment(parentEnvironment),
  };
}

/** Clones the inherited environment, removes explicit parent-only names, and adds only child depth. */
export function childEnvironment(parentEnvironment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment = { ...parentEnvironment };
  for (const name of parseNameList(parentEnvironment[CHILD_UNSET_ENV])) delete environment[name];
  environment[CHILD_DEPTH_ENV] = String(readDepth(parentEnvironment[CHILD_DEPTH_ENV]) + 1);
  return environment;
}

function detectParentPiRuntime(parentEnvironment: NodeJS.ProcessEnv): ParentPiRuntime {
  if (!isTruthy(parentEnvironment[PI_PARENT_MARKER_ENV])) return { executable: "pi" };

  const executable = process.execPath.trim();
  const entrypoint = process.argv[1]?.trim();
  const executableName = basename(executable).toLowerCase();
  if (executableName === "pi" || executableName === "pi.exe") return { executable };
  if (entrypoint) return { executable, entrypoint };
  return { executable: "pi" };
}

function normalizeParentRuntime(runtime: ParentPiRuntime): ParentPiRuntime {
  const executable = requireNonempty(runtime.executable, "parent runtime executable", "invalid_parent_runtime");
  if (runtime.entrypoint === undefined) return { executable };
  return {
    executable,
    entrypoint: requireNonempty(runtime.entrypoint, "parent Pi entrypoint", "invalid_parent_runtime"),
  };
}

function parsePathList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNameList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readDepth(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function isTruthy(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function requireNonempty(value: string, name: string, kind: AgentInvocationErrorKind = "invalid_request"): string {
  if (!value.trim()) throw new AgentInvocationError(kind, `Agent invocation ${name} must not be empty`);
  return value;
}
