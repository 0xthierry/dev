import { delimiter, resolve } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentDefinition } from "../agents/types";
import type { PiThinkingLevel } from "../thinking";
import type { AgentContextMode } from "../tools/schemas";

export const CHILD_DEPTH_ENV = "PI_SUBAGENT_DEPTH";
export const CHILD_NO_EXTENSIONS_ENV = "PI_SUBAGENT_CHILD_NO_EXTENSIONS";
export const CHILD_EXTENSIONS_ENV = "PI_SUBAGENT_CHILD_EXTENSIONS";
export const CHILD_UNSET_ENV = "PI_SUBAGENT_CHILD_UNSET_ENV";

export interface AgentRunRequest {
  agent: AgentDefinition;
  task: string;
  description?: string;
  context: AgentContextMode;
  cwd: string;
  parentSessionFile?: string;
  modelRef?: string;
  thinking?: PiThinkingLevel;
}

export interface ChildInvocation {
  args: string[];
  env: NodeJS.ProcessEnv;
}

export function buildAgentRunRequest(
  ctx: ExtensionContext,
  task: Omit<AgentRunRequest, "cwd" | "modelRef" | "thinking" | "parentSessionFile">,
  thinking: PiThinkingLevel,
): AgentRunRequest {
  return {
    ...task,
    cwd: ctx.cwd,
    parentSessionFile: ctx.sessionManager.getSessionFile() ?? undefined,
    modelRef: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
    thinking,
  };
}

export function buildChildInvocation(request: AgentRunRequest, promptPath: string): ChildInvocation {
  const args = ["--mode", "json", "-p"];

  if (isTruthy(process.env[CHILD_NO_EXTENSIONS_ENV])) args.push("--no-extensions");
  for (const extensionPath of parsePathList(process.env[CHILD_EXTENSIONS_ENV])) args.push("-e", resolve(extensionPath));

  if (request.context === "fork") {
    if (!request.parentSessionFile) throw new Error("Agent context=fork requires a saved parent Pi session.");
    args.push("--fork", request.parentSessionFile);
  } else {
    args.push("--no-session");
  }

  if (request.modelRef) args.push("--model", request.modelRef);
  if (request.thinking) args.push("--thinking", request.thinking);
  args.push("--append-system-prompt", promptPath, `Task: ${request.task}`);

  return { args, env: childEnvironment(process.env) };
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
