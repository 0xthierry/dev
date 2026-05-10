import { resolve } from "node:path";
import type { PiThinkingLevel } from "../thinking";
import type { PiBlueprintNode } from "../types";

export const BLUEPRINT_DEPTH_ENV = "PI_BLUEPRINT_DEPTH";

export interface PiNodeInvocationRequest {
  node: PiBlueprintNode;
  contextFile: string;
  prompt: string;
  systemPromptFile?: string;
  sessionsDir: string;
  parentModelRef?: string;
  parentThinking?: PiThinkingLevel;
}

export interface PiNodeInvocation {
  args: string[];
  env: NodeJS.ProcessEnv;
}

export function buildPiNodeInvocation(request: PiNodeInvocationRequest): PiNodeInvocation {
  const args = ["--mode", "json", "-p", "--session-dir", request.sessionsDir];
  const model = readModel(request.node.model, request.parentModelRef);
  const thinking = request.node.thinking ?? request.parentThinking;

  if (request.systemPromptFile) args.push("--append-system-prompt", request.systemPromptFile);
  if (model) args.push("--model", model);
  if (thinking) args.push("--thinking", thinking);
  if (request.node.tools?.length) args.push("--tools", request.node.tools.join(","));
  for (const skill of request.node.skills ?? []) args.push("--skill", skill);

  args.push(`@${resolve(request.contextFile)}`, request.prompt);
  return { args, env: childEnvironment(process.env) };
}

export function childEnvironment(parentEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...parentEnv, [BLUEPRINT_DEPTH_ENV]: String(readDepth(parentEnv[BLUEPRINT_DEPTH_ENV]) + 1) };
}

export function shouldRegisterBlueprintInCurrentProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return readDepth(env[BLUEPRINT_DEPTH_ENV]) === 0;
}

function readModel(model: string | undefined, parentModelRef: string | undefined): string | undefined {
  if (!model || model === "inherit") return parentModelRef;
  return model;
}

function readDepth(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}
