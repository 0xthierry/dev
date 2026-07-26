import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { findAgentSessionFileById } from "../sessions/paths";
import { createAgentArtifactPlan, finalizeAgentRunArtifacts, writeAgentInputArtifact } from "./artifacts";
import { synthesizeCrashHandoff } from "./handoff";
import { type AgentRunRequest, buildChildInvocation } from "./invocation";
import { applyChildJsonEvent, type ChildAgentEventState, createChildAgentEventState } from "./json-events";
import { writeAgentPromptFile } from "./prompt-file";
import { type AgentRunResult, buildAgentRunResult } from "./run-result";

export type AgentProgressCallback = (result: AgentRunResult) => void;

const CHILD_COMPLETION_EXIT_GRACE_MS = 250;
const CHILD_PROGRESS_INTERVAL_MS = 1_000;

export async function runChildPiAgent(
  request: AgentRunRequest,
  signal: AbortSignal | undefined,
  onProgress?: AgentProgressCallback,
): Promise<AgentRunResult> {
  const startedAt = Date.now();
  const artifactPlan = createAgentArtifactPlan({
    cwd: request.cwd,
    sessionId: request.resumeAgentId,
    agentName: request.agent.name,
  });
  let artifactSetupError: string | undefined;
  try {
    await writeAgentInputArtifact(artifactPlan, formatAgentInputArtifact(request));
  } catch (error) {
    artifactSetupError = error instanceof Error ? error.message : String(error);
  }
  const promptFile = await writeAgentPromptFile(request.agent);

  try {
    const invocation = buildChildInvocation(request, promptFile.filePath);
    const state = createChildAgentEventState();
    const refreshDuration = () => {
      state.durationMs = Math.max(0, Date.now() - startedAt);
    };
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
      let completionExitTimer: ReturnType<typeof setTimeout> | undefined;
      let progressInterval: ReturnType<typeof setInterval> | undefined;

      const emitProgress = () => {
        refreshDuration();
        onProgress?.(buildAgentRunResult(request, state, -1, stderr));
      };

      const requestCompletionExit = () => {
        if (closed || completionExitTimer) return;
        completionExitTimer = setTimeout(() => {
          if (!closed) child.kill("SIGTERM");
        }, CHILD_COMPLETION_EXIT_GRACE_MS);
        completionExitTimer.unref();
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
        if (completionExitTimer) clearTimeout(completionExitTimer);
        if (progressInterval) clearInterval(progressInterval);
        signal?.removeEventListener("abort", abortChild);
        resolveExit(exitCode);
      };

      const processStdoutLine = (line: string) => {
        if (applyChildJsonEvent(state, line)) emitProgress();
        if (state.agentEnded) requestCompletionExit();
      };

      child.stdout.on("data", (chunk) => {
        stdoutBuffer += String(chunk);
        const lines = stdoutBuffer.split("\n");
        stdoutBuffer = lines.pop() ?? "";
        for (const line of lines) processStdoutLine(line);
      });

      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });

      child.once("error", (error) => {
        stderr += `${error.message}\n`;
        finalize(1);
      });

      child.once("close", (code) => {
        if (stdoutBuffer.trim()) processStdoutLine(stdoutBuffer);
        finalize(code ?? 0);
      });

      if (onProgress) {
        progressInterval = setInterval(emitProgress, CHILD_PROGRESS_INTERVAL_MS);
        progressInterval.unref();
      }

      if (signal?.aborted) abortChild();
      else signal?.addEventListener("abort", abortChild, { once: true });
    });

    refreshDuration();
    const finalExitCode = aborted ? 1 : exitCode;
    const sessionFile = await resolveChildSessionFile(request, state);
    const fallbackOutput = state.finalOutput.trim()
      ? state.finalOutput
      : synthesizeCrashHandoff({
          agentName: request.agent.name,
          state,
          exitCode: finalExitCode,
          stderr,
          sessionFile,
        });
    const artifacts = await finalizeAgentRunArtifacts(artifactPlan, {
      sessionId: state.sessionId ?? request.resumeAgentId,
      fallbackOutput,
      metadata: buildAgentArtifactMetadata(request, state, finalExitCode, stderr, sessionFile, artifactSetupError),
    });
    const resultState = { ...state, finalOutput: artifacts.ok ? artifacts.output : fallbackOutput };
    const result = buildAgentRunResult(
      request,
      resultState,
      finalExitCode,
      stderr,
      sessionFile,
      artifacts.ok ? artifacts.paths.outputPath : undefined,
      artifacts.ok ? undefined : artifacts.error,
      artifacts.ok ? artifacts.paths : undefined,
    );
    onProgress?.(result);
    return result;
  } finally {
    await rm(promptFile.dir, { recursive: true, force: true });
  }
}

function formatAgentInputArtifact(request: AgentRunRequest): string {
  return [
    `# Subagent Input: ${request.agent.name}`,
    "",
    `Agent: ${request.agent.name}`,
    request.description ? `Description: ${request.description}` : undefined,
    `Context: ${request.context}`,
    request.thinking ? `Thinking: ${request.thinking}` : undefined,
    request.modelRef ? `Model: ${request.modelRef}` : undefined,
    "",
    "## Task",
    "",
    request.task,
    "",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function buildAgentArtifactMetadata(
  request: AgentRunRequest,
  state: ChildAgentEventState,
  exitCode: number,
  stderr: string,
  sessionFile: string | undefined,
  artifactSetupError: string | undefined,
): Record<string, unknown> {
  return {
    agent: request.agent.name,
    description: request.description,
    task: request.task,
    context: request.context,
    exitCode,
    sessionId: state.sessionId ?? request.resumeAgentId,
    sessionFile,
    model: state.model,
    thinking: request.thinking,
    stopReason: state.stopReason,
    errorMessage: state.errorMessage,
    stderr: stderr.trim() || undefined,
    usage: state.usage,
    durationMs: state.durationMs,
    artifactSetupError,
  };
}

async function resolveChildSessionFile(
  request: AgentRunRequest,
  state: ChildAgentEventState,
): Promise<string | undefined> {
  if (request.resumeSessionFile) return request.resumeSessionFile;
  if (!state.sessionId) return undefined;

  const lookup = await findAgentSessionFileById(request.agentSessionDir, state.sessionId);
  return lookup.ok ? lookup.match.sessionFile : undefined;
}
