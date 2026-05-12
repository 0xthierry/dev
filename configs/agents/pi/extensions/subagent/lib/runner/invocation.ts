import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentDefinition } from "../agents/types";
import { getProjectAgentSessionDir } from "../sessions/paths";
import type { PiThinkingLevel } from "../thinking";
import type { AgentContextMode } from "../tools/schemas";

export const CHILD_DEPTH_ENV = "PI_SUBAGENT_DEPTH";
export const CHILD_NO_EXTENSIONS_ENV = "PI_SUBAGENT_CHILD_NO_EXTENSIONS";
export const CHILD_EXTENSIONS_ENV = "PI_SUBAGENT_CHILD_EXTENSIONS";
export const CHILD_UNSET_ENV = "PI_SUBAGENT_CHILD_UNSET_ENV";
export const CHILD_RUNTIME_EXTENSION_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "child-runtime.ts");

export type AgentRunContextMode = AgentContextMode | "resume";

export interface AgentRunRequest {
  agent: AgentDefinition;
  task: string;
  description?: string;
  context: AgentRunContextMode;
  cwd: string;
  agentSessionDir: string;
  parentSessionFile?: string;
  modelRef?: string;
  thinking?: PiThinkingLevel;
  resumeAgentId?: string;
  resumeSessionFile?: string;
  outputArtifactPath?: string;
}

export interface ChildInvocation {
  args: string[];
  env: NodeJS.ProcessEnv;
}

export function buildAgentRunRequest(
  ctx: ExtensionContext,
  task: Omit<AgentRunRequest, "agentSessionDir" | "cwd" | "modelRef" | "thinking" | "parentSessionFile">,
  thinking: PiThinkingLevel,
): AgentRunRequest {
  return {
    ...task,
    cwd: ctx.cwd,
    agentSessionDir: getProjectAgentSessionDir(ctx.cwd),
    parentSessionFile: ctx.sessionManager.getSessionFile() ?? undefined,
    modelRef: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
    thinking,
  };
}

export function buildChildInvocation(request: AgentRunRequest, promptPath: string): ChildInvocation {
  const args = ["--mode", "json", "-p"];

  if (isTruthy(process.env[CHILD_NO_EXTENSIONS_ENV])) args.push("--no-extensions");
  args.push("-e", CHILD_RUNTIME_EXTENSION_PATH);
  for (const extensionPath of parsePathList(process.env[CHILD_EXTENSIONS_ENV])) args.push("-e", resolve(extensionPath));

  if (request.context === "resume") {
    if (!request.resumeSessionFile) throw new Error("agent resume requires a saved child Pi session file.");
    args.push("--session", request.resumeSessionFile);
  } else {
    args.push("--session-dir", request.agentSessionDir);
    if (request.context === "fork") {
      if (!request.parentSessionFile) throw new Error("agent context=fork requires a saved parent Pi session.");
      args.push("--fork", request.parentSessionFile);
    }
  }

  if (request.modelRef) args.push("--model", request.modelRef);
  if (request.thinking) args.push("--thinking", request.thinking);
  args.push("--append-system-prompt", promptPath, formatChildTask(request));

  return { args, env: childEnvironment(process.env) };
}

function formatChildTask(request: AgentRunRequest): string {
  if (!request.outputArtifactPath) return `Task: ${request.task}`;
  return [
    `Task: ${request.task}`,
    "",
    "---",
    "Output artifact:",
    `Write your detailed handoff report to: ${request.outputArtifactPath}`,
    "This artifact is the authoritative result for the parent session. Do not make it terse just to save parent context.",
    "You may write this artifact even when your role is otherwise read-only; do not modify repository files unless the task explicitly allows it.",
    "After writing the artifact, keep your final chat response brief and mention the artifact path.",
  ].join("\n");
}

export function childEnvironment(parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...parentEnv };
  for (const name of parseNameList(parentEnv[CHILD_UNSET_ENV])) delete env[name];
  env[CHILD_DEPTH_ENV] = String(readDepth(parentEnv[CHILD_DEPTH_ENV]) + 1);
  return env;
}

export function shouldRegisterInCurrentProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return readDepth(env[CHILD_DEPTH_ENV]) === 0;
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
