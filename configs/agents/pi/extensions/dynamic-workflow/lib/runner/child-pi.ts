import { spawn } from "node:child_process";
import { open, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkflowChildAgentRequest, WorkflowChildAgentResult } from "../runtime/types";
import { createWorkflowAgentArtifactPaths } from "./artifacts";
import { buildWorkflowChildInvocation } from "./invocation";
import { applyWorkflowChildJsonEvent, cloneWorkflowActivity, createWorkflowChildEventState } from "./json-events";
import { prepareWorkflowOutput } from "./output";

export type WorkflowAgentProgressCallback = (result: WorkflowChildAgentResult) => void;

const CHILD_COMPLETION_EXIT_GRACE_MS = 250;
const SESSION_HEADER_READ_BYTES = 4096;

export async function runWorkflowChildPiAgent(
  request: WorkflowChildAgentRequest,
  signal: AbortSignal | undefined,
  onProgress?: WorkflowAgentProgressCallback,
): Promise<WorkflowChildAgentResult> {
  const artifacts = await createWorkflowAgentArtifactPaths({
    runDir: request.runDir,
    index: request.index,
    label: request.label,
  });
  await writeFile(artifacts.inputPath, formatAgentInput(request), "utf8");

  const schemaFile = request.schema ? join(request.runDir, "agents", `${request.index}_schema.json`) : undefined;
  if (schemaFile) await writeFile(schemaFile, JSON.stringify(request.schema, null, 2), "utf8");

  try {
    const invocation = buildWorkflowChildInvocation(request, schemaFile);
    const state = createWorkflowChildEventState();
    let stdout = "";
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

      const emitProgress = () => {
        onProgress?.(buildWorkflowChildAgentResult(request, state, -1, stderr));
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

      const finish = (code: number) => {
        if (closed) return;
        closed = true;
        if (completionExitTimer) clearTimeout(completionExitTimer);
        signal?.removeEventListener("abort", abortChild);
        resolveExit(code);
      };

      const processStdoutLine = (line: string) => {
        if (line.trim()) stdout += `${line}\n`;
        if (applyWorkflowChildJsonEvent(state, line)) emitProgress();
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
        finish(1);
      });

      child.once("close", (code) => {
        if (stdoutBuffer.trim()) processStdoutLine(stdoutBuffer);
        finish(code ?? 0);
      });

      if (signal?.aborted) abortChild();
      else signal?.addEventListener("abort", abortChild, { once: true });
    });

    await writeFile(artifacts.stdoutPath, stdout, "utf8");
    await writeFile(artifacts.stderrPath, stderr, "utf8");
    const finalExitCode = aborted ? 1 : exitCode;
    const sessionFile = await resolveSessionFile(request.sessionsDir, state.sessionId);
    const artifactOutput = rawArtifactOutput(request, state, stderr, finalExitCode, aborted);
    const result = buildWorkflowChildAgentResult(
      request,
      state,
      finalExitCode,
      stderr,
      sessionFile,
      artifacts.outputPath,
      aborted,
    );
    await writeFile(artifacts.outputPath, artifactOutput, "utf8");
    onProgress?.(result);
    return result;
  } finally {
    if (schemaFile) await rm(schemaFile, { force: true });
  }
}

function buildWorkflowChildAgentResult(
  request: WorkflowChildAgentRequest,
  state: ReturnType<typeof createWorkflowChildEventState>,
  exitCode: number,
  stderr: string,
  sessionFile?: string,
  outputArtifactPath?: string,
  aborted = false,
): WorkflowChildAgentResult {
  const status = inferRunStatus(Boolean(request.schema), state, exitCode, aborted);
  const value = request.schema
    ? state.structuredOutput
    : state.finalOutput || state.errorMessage || stderr.trim() || null;
  const output = typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2);
  const prepared = prepareWorkflowOutput(output || fallbackOutput(status), outputArtifactPath);

  return {
    label: request.label,
    status,
    ok: status === "succeeded",
    output: prepared.text,
    value: status === "succeeded" ? value : null,
    outputTruncated: prepared.truncated,
    ...(outputArtifactPath ? { outputArtifactPath } : {}),
    stderr,
    exitCode,
    activity: cloneWorkflowActivity(state.activity),
    usage: { ...state.usage },
    sessionId: state.sessionId,
    sessionFile,
    model: state.model,
    stopReason: aborted ? "aborted" : state.stopReason,
    errorMessage: state.errorMessage,
  };
}

function inferRunStatus(
  requiresStructuredOutput: boolean,
  state: ReturnType<typeof createWorkflowChildEventState>,
  exitCode: number,
  aborted: boolean,
): WorkflowChildAgentResult["status"] {
  if (exitCode === -1 && !state.agentEnded) return "running";
  if (aborted || state.stopReason === "aborted" || state.stopReason === "error" || state.errorMessage) return "failed";
  if (requiresStructuredOutput && !state.structuredOutputCalled) return "failed";
  if (exitCode === 0 || state.agentEnded || state.finalOutput.trim() || state.structuredOutputCalled)
    return "succeeded";
  return "failed";
}

function rawArtifactOutput(
  request: WorkflowChildAgentRequest,
  state: ReturnType<typeof createWorkflowChildEventState>,
  stderr: string,
  exitCode: number,
  aborted: boolean,
): string {
  const status = inferRunStatus(Boolean(request.schema), state, exitCode, aborted);
  const value = request.schema
    ? state.structuredOutput
    : state.finalOutput || state.errorMessage || stderr.trim() || fallbackOutput(status);
  return typeof value === "string" ? value : JSON.stringify(value ?? "", null, 2);
}

function fallbackOutput(status: WorkflowChildAgentResult["status"]): string {
  if (status === "queued") return "(queued)";
  if (status === "running") return "(running...)";
  if (status === "skipped") return "(skipped)";
  return "(no output)";
}

function formatAgentInput(request: WorkflowChildAgentRequest): string {
  return [
    `# Workflow Agent: ${request.label}`,
    "",
    `Run: ${request.runId}`,
    request.phase ? `Phase: ${request.phase}` : undefined,
    request.modelRef ? `Model: ${request.modelRef}` : undefined,
    request.thinking ? `Thinking: ${request.thinking}` : undefined,
    "",
    "## Task",
    "",
    request.prompt,
    "",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

async function resolveSessionFile(sessionDir: string, sessionId: string | undefined): Promise<string | undefined> {
  if (!sessionId) return undefined;
  let names: string[];
  try {
    names = await readdir(sessionDir);
  } catch {
    return undefined;
  }

  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const file = join(sessionDir, name);
    const id = await readSessionId(file);
    if (id === sessionId) return file;
  }
  return undefined;
}

async function readSessionId(sessionFile: string): Promise<string | undefined> {
  let file: Awaited<ReturnType<typeof open>> | undefined;
  try {
    file = await open(sessionFile, "r");
    const buffer = Buffer.alloc(SESSION_HEADER_READ_BYTES);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    const firstLine = buffer.toString("utf8", 0, bytesRead).split("\n", 1)[0];
    const header = JSON.parse(firstLine) as unknown;
    if (!header || typeof header !== "object") return undefined;
    const id = (header as Record<string, unknown>).id;
    return typeof id === "string" && id ? id : undefined;
  } catch {
    return undefined;
  } finally {
    await file?.close().catch(() => undefined);
  }
}
