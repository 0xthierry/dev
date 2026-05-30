import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkflowChildAgentRequest } from "../runtime/types";
import { WORKFLOW_STRUCTURED_SCHEMA_FILE_ENV } from "./structured-output-runtime";

export const WORKFLOW_DEPTH_ENV = "PI_DYNAMIC_WORKFLOW_DEPTH";
export const WORKFLOW_CHILD_NO_EXTENSIONS_ENV = "PI_DYNAMIC_WORKFLOW_CHILD_NO_EXTENSIONS";
export const WORKFLOW_CHILD_EXTENSIONS_ENV = "PI_DYNAMIC_WORKFLOW_CHILD_EXTENSIONS";
export const WORKFLOW_CHILD_UNSET_ENV = "PI_DYNAMIC_WORKFLOW_CHILD_UNSET_ENV";
export const WORKFLOW_STRUCTURED_RUNTIME_EXTENSION_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "structured-output-runtime.ts",
);

export interface WorkflowChildInvocation {
  args: string[];
  env: NodeJS.ProcessEnv;
}

export function buildWorkflowChildInvocation(
  request: WorkflowChildAgentRequest,
  schemaFile: string | undefined,
): WorkflowChildInvocation {
  const args = ["--mode", "json", "-p"];

  if (isTruthy(process.env[WORKFLOW_CHILD_NO_EXTENSIONS_ENV])) args.push("--no-extensions");
  if (schemaFile) args.push("-e", WORKFLOW_STRUCTURED_RUNTIME_EXTENSION_PATH);
  for (const extensionPath of parsePathList(process.env[WORKFLOW_CHILD_EXTENSIONS_ENV])) {
    args.push("-e", resolve(extensionPath));
  }

  args.push("--session-dir", request.sessionsDir);
  if (request.modelRef) args.push("--model", request.modelRef);
  if (request.thinking) args.push("--thinking", request.thinking);
  args.push(formatChildPrompt(request, Boolean(schemaFile)));

  return { args, env: childEnvironment(process.env, schemaFile) };
}

export function childEnvironment(parentEnv: NodeJS.ProcessEnv, schemaFile?: string): NodeJS.ProcessEnv {
  const env = { ...parentEnv };
  for (const name of parseNameList(parentEnv[WORKFLOW_CHILD_UNSET_ENV])) delete env[name];
  env[WORKFLOW_DEPTH_ENV] = String(readDepth(parentEnv[WORKFLOW_DEPTH_ENV]) + 1);
  if (schemaFile) env[WORKFLOW_STRUCTURED_SCHEMA_FILE_ENV] = schemaFile;
  else delete env[WORKFLOW_STRUCTURED_SCHEMA_FILE_ENV];
  return env;
}

export function shouldRegisterWorkflowInCurrentProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return readDepth(env[WORKFLOW_DEPTH_ENV]) === 0;
}

function formatChildPrompt(request: WorkflowChildAgentRequest, structured: boolean): string {
  const parts = [
    "You are a workflow child agent. The parent Pi session owns orchestration and synthesis.",
    "Do not spawn more workflow agents. Complete only the focused task below.",
    request.instructions,
    request.phase ? `Workflow phase: ${request.phase}` : undefined,
    `Task label: ${request.label}`,
    "",
    request.prompt,
    "",
    "Write concise final output. Preserve concrete file paths, commands checked, and uncertainty.",
  ];

  if (structured) {
    parts.push(
      [
        "Final output contract:",
        "- Your final action MUST be a structured_output tool call.",
        "- The structured_output arguments are the return value of this workflow agent.",
        "- Do not emit a prose final answer instead of structured_output.",
        "- If you need to inspect files or run commands first, do so, then call structured_output exactly once.",
      ].join("\n"),
    );
  }

  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join("\n\n");
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
