import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateTail } from "@earendil-works/pi-coding-agent";
import { type BlueprintTemplateState, renderBlueprintTemplate } from "../template";
import type { BlueprintNodeResult, CommandBlueprintNode } from "../types";
import type { ShellCommandResult } from "./shell";

export interface ExecuteCommandNodeOptions {
  nodeId: string;
  node: CommandBlueprintNode;
  attempt: number;
  cwd: string;
  nodeDir: string;
  templateState: BlueprintTemplateState;
  signal?: AbortSignal;
  runShellCommand: (
    command: string,
    options: { cwd: string; signal?: AbortSignal; timeoutMs?: number },
  ) => Promise<ShellCommandResult>;
}

export async function executeCommandNode(options: ExecuteCommandNodeOptions): Promise<BlueprintNodeResult> {
  const startedAt = new Date().toISOString();
  const command = renderBlueprintTemplate(options.node.run, options.templateState);
  await writeFile(join(options.nodeDir, "command.txt"), command, "utf8");

  const result = await options.runShellCommand(command, {
    cwd: options.cwd,
    signal: options.signal,
    timeoutMs: options.node.timeoutMs,
  });
  const output = prepareCommandOutput(result);

  return {
    nodeId: options.nodeId,
    type: "command",
    attempt: options.attempt,
    status: result.exitCode === 0 && !result.timedOut ? "success" : "failure",
    output,
    command,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    errorMessage: result.timedOut ? "Command timed out." : undefined,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

function prepareCommandOutput(result: ShellCommandResult): string {
  const raw = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n");
  const output = raw || `(exit ${result.exitCode})`;
  const truncation = truncateTail(output, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  if (!truncation.truncated) return truncation.content;
  return [
    truncation.content,
    "",
    `[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`,
    ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`,
  ].join("\n");
}
