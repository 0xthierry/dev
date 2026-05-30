import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type { WorkflowRunArtifacts } from "../runtime/types";

export interface WorkflowAgentArtifactPaths {
  inputPath: string;
  outputPath: string;
  stdoutPath: string;
  stderrPath: string;
}

export async function createWorkflowRunArtifacts(request: {
  cwd: string;
  workflowName: string;
  agentDir?: string;
}): Promise<WorkflowRunArtifacts> {
  const runId = randomUUID();
  const rootDir = join(
    request.agentDir ?? getAgentDir(),
    "workflow-runs",
    encodeProjectCwd(request.cwd),
    safeName(request.workflowName),
  );
  const runDir = join(rootDir, runId);
  const sessionsDir = join(runDir, "sessions");
  await mkdir(sessionsDir, { recursive: true });

  return {
    runId,
    runDir,
    sessionsDir,
    writeScript: async (script) => {
      await writeFile(join(runDir, "workflow.js"), script, "utf8");
    },
  };
}

export async function createWorkflowAgentArtifactPaths(request: {
  runDir: string;
  index: number;
  label: string;
}): Promise<WorkflowAgentArtifactPaths> {
  const agentDir = join(
    request.runDir,
    "agents",
    `${String(request.index).padStart(2, "0")}_${safeName(request.label)}`,
  );
  await mkdir(agentDir, { recursive: true });
  return {
    inputPath: join(agentDir, "input.md"),
    outputPath: join(agentDir, "output.md"),
    stdoutPath: join(agentDir, "stdout.jsonl"),
    stderrPath: join(agentDir, "stderr.log"),
  };
}

export function encodeProjectCwd(cwd: string): string {
  const normalized = resolve(cwd);
  const slug = normalized
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return `--${slug || "root"}--`;
}

export function safeName(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80) || "workflow"
  );
}
