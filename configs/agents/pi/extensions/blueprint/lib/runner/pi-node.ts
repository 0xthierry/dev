import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateTail } from "@earendil-works/pi-coding-agent";
import { type BlueprintTemplateState, renderBlueprintTemplate } from "../template";
import type { BlueprintNodeResult, PiBlueprintNode } from "../types";
import { applyPiChildJsonEvent, createPiChildEventState } from "./pi-events";
import { buildPiNodeInvocation } from "./pi-invocation";

export interface ExecutePiNodeOptions {
  nodeId: string;
  node: PiBlueprintNode;
  attempt: number;
  blueprintDir: string;
  nodeDir: string;
  cwd: string;
  contextFile: string;
  sessionsDir: string;
  templateState: BlueprintTemplateState;
  signal?: AbortSignal;
  parentModelRef?: string;
  parentThinking?: PiBlueprintNode["thinking"];
}

export async function executePiNode(options: ExecutePiNodeOptions): Promise<BlueprintNodeResult> {
  const startedAt = new Date().toISOString();
  const prompt = renderBlueprintTemplate(
    await readNodePrompt(options.node, options.blueprintDir),
    options.templateState,
  );
  const systemPrompt = renderBlueprintTemplate(
    await readNodeSystemPrompt(options.node, options.blueprintDir),
    options.templateState,
  );
  const systemPromptFile = systemPrompt ? join(options.nodeDir, "system-prompt.md") : undefined;
  await writeFile(join(options.nodeDir, "prompt.md"), prompt, "utf8");
  if (systemPromptFile) await writeFile(systemPromptFile, systemPrompt, "utf8");

  const invocation = buildPiNodeInvocation({
    node: options.node,
    contextFile: options.contextFile,
    prompt,
    systemPromptFile,
    sessionsDir: options.sessionsDir,
    parentModelRef: options.parentModelRef,
    parentThinking: options.parentThinking,
  });
  await writeFile(
    join(options.nodeDir, "invocation.json"),
    `${JSON.stringify({ args: invocation.args }, null, 2)}\n`,
    "utf8",
  );

  const state = createPiChildEventState();
  let stdout = "";
  let stderr = "";
  let stdoutBuffer = "";
  let aborted = false;

  const exitCode = await new Promise<number>((resolveExit) => {
    const child = spawn("pi", invocation.args, {
      cwd: options.cwd,
      env: invocation.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let closed = false;

    const abort = () => {
      if (closed) return;
      aborted = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!closed) child.kill("SIGKILL");
      }, 5_000).unref();
    };

    const finish = (code: number) => {
      if (closed) return;
      closed = true;
      options.signal?.removeEventListener("abort", abort);
      resolveExit(code);
    };

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      stdout += text;
      stdoutBuffer += text;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) applyPiChildJsonEvent(state, line);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.once("error", (error) => {
      stderr += `${error.message}\n`;
      finish(1);
    });

    child.once("close", (code) => {
      if (stdoutBuffer.trim()) applyPiChildJsonEvent(state, stdoutBuffer);
      finish(code ?? 0);
    });

    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
  });

  await writeFile(join(options.nodeDir, "stdout.jsonl"), stdout, "utf8");
  await writeFile(join(options.nodeDir, "stderr.log"), stderr, "utf8");

  const status =
    exitCode === 0 && state.stopReason !== "error" && state.stopReason !== "aborted" && !aborted
      ? "success"
      : "failure";
  const output = prepareNodeOutput(state.finalOutput || state.errorMessage || stderr.trim() || "(no output)");
  return {
    nodeId: options.nodeId,
    type: "pi",
    attempt: options.attempt,
    status,
    output,
    stdout,
    stderr,
    exitCode: aborted ? 1 : exitCode,
    model: state.model,
    stopReason: aborted ? "aborted" : state.stopReason,
    errorMessage: state.errorMessage,
    startedAt,
    finishedAt: new Date().toISOString(),
  };
}

async function readNodePrompt(node: PiBlueprintNode, blueprintDir: string): Promise<string> {
  if (node.promptFile) return readFile(join(blueprintDir, node.promptFile), "utf8");
  return node.prompt;
}

async function readNodeSystemPrompt(node: PiBlueprintNode, blueprintDir: string): Promise<string> {
  const parts = [];
  if (node.systemPromptFile) parts.push(await readFile(join(blueprintDir, node.systemPromptFile), "utf8"));
  if (node.systemPrompt) parts.push(node.systemPrompt);
  return parts.join("\n\n").trim();
}

function prepareNodeOutput(output: string): string {
  const truncation = truncateTail(output, { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES });
  if (!truncation.truncated) return truncation.content;
  return [
    truncation.content,
    "",
    `[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`,
    ` (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}).]`,
  ].join("\n");
}
