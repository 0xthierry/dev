import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { type AgentRunRequest, buildChildInvocation } from "./invocation";
import { applyChildJsonEvent, createChildAgentEventState } from "./json-events";
import { writeAgentPromptFile } from "./prompt-file";
import { type AgentRunResult, buildAgentRunResult } from "./run-result";

export type AgentProgressCallback = (result: AgentRunResult) => void;

export async function runChildPiAgent(
  request: AgentRunRequest,
  signal: AbortSignal | undefined,
  onProgress?: AgentProgressCallback,
): Promise<AgentRunResult> {
  const promptFile = await writeAgentPromptFile(request.agent);

  try {
    const invocation = buildChildInvocation(request, promptFile.filePath);
    const state = createChildAgentEventState();
    let stderr = "";
    let stdoutBuffer = "";
    let aborted = false;

    const exitCode = await new Promise<number>((resolveExit) => {
      const child = spawn("pi", invocation.args, {
        cwd: request.cwd,
        env: invocation.env,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let closed = false;

      const emitProgress = () => {
        onProgress?.(buildAgentRunResult(request, state, -1, stderr));
      };

      const abortChild = () => {
        if (closed) return;
        aborted = true;
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!closed) child.kill("SIGKILL");
        }, 5_000).unref();
      };

      const finalize = (exitCode: number) => {
        if (closed) return;
        closed = true;
        signal?.removeEventListener("abort", abortChild);
        resolveExit(exitCode);
      };

      child.stdout.on("data", (chunk) => {
        stdoutBuffer += String(chunk);
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (applyChildJsonEvent(state, line)) emitProgress();
        }
      });

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.once("error", (error) => {
        stderr += `${error.message}\n`;
        finalize(1);
      });

      child.once("close", (code) => {
        if (stdoutBuffer.trim()) applyChildJsonEvent(state, stdoutBuffer);
        finalize(code ?? 0);
      });

      if (signal?.aborted) abortChild();
      else signal?.addEventListener("abort", abortChild, { once: true });
    });

    const result = buildAgentRunResult(request, state, aborted ? 1 : exitCode, stderr);
    onProgress?.(result);
    return result;
  } finally {
    await rm(promptFile.dir, { recursive: true, force: true });
  }
}
