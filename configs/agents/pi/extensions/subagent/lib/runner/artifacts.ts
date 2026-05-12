import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";

const ARTIFACT_ROOT_DIR = "agent-sessions-artifacts";
const ARTIFACT_DIR = "artifacts";

export interface AgentArtifactPaths {
  inputPath: string;
  outputPath: string;
  jsonlPath: string;
  metadataPath: string;
}

export interface AgentArtifactPlan {
  agentDir: string;
  agentName: string;
  createdAt: Date;
  sessionId: string;
  pending: boolean;
  paths: AgentArtifactPaths;
}

export interface FinalizeAgentRunArtifactsInput {
  sessionId?: string;
  fallbackOutput: string;
  jsonlLines: string[];
  metadata: Record<string, unknown>;
}

export type FinalizeAgentRunArtifactsResult =
  | { ok: true; paths: AgentArtifactPaths; output: string; usedChildOutputFile: boolean }
  | { ok: false; error: string };

export function createAgentArtifactPlan(input: {
  sessionId?: string;
  agentName: string;
  agentDir?: string;
  now?: Date;
}): AgentArtifactPlan {
  const sessionId = input.sessionId?.trim() || `pending-${randomUUID()}`;
  const agentDir = input.agentDir ?? getAgentDir();
  const createdAt = input.now ?? new Date();
  return {
    agentDir,
    agentName: input.agentName,
    createdAt,
    sessionId,
    pending: !input.sessionId?.trim(),
    paths: getAgentArtifactPaths({ sessionId, agentName: input.agentName, agentDir, now: createdAt }),
  };
}

export function getAgentSessionArtifactDir(sessionId: string, agentDir = getAgentDir()): string {
  return join(agentDir, ARTIFACT_ROOT_DIR, safeArtifactSegment(sessionId), ARTIFACT_DIR);
}

export function getAgentArtifactPaths(input: {
  sessionId: string;
  agentName: string;
  agentDir?: string;
  now?: Date;
}): AgentArtifactPaths {
  const dir = getAgentSessionArtifactDir(input.sessionId, input.agentDir);
  const stem = `${artifactTimestamp(input.now ?? new Date())}_${safeArtifactSegment(input.agentName)}`;
  return {
    inputPath: join(dir, `${stem}_input.md`),
    outputPath: join(dir, `${stem}_output.md`),
    jsonlPath: join(dir, `${stem}.jsonl`),
    metadataPath: join(dir, `${stem}_meta.json`),
  };
}

export function getAgentOutputArtifactPath(input: {
  sessionId: string;
  agentName: string;
  agentDir?: string;
  now?: Date;
}): string {
  return getAgentArtifactPaths(input).outputPath;
}

export async function writeAgentInputArtifact(plan: AgentArtifactPlan, content: string): Promise<void> {
  await writeTextArtifact(plan.paths.inputPath, content);
}

export async function finalizeAgentRunArtifacts(
  plan: AgentArtifactPlan,
  input: FinalizeAgentRunArtifactsInput,
): Promise<FinalizeAgentRunArtifactsResult> {
  const sessionId = input.sessionId?.trim() || plan.sessionId;
  const paths = getAgentArtifactPaths({
    sessionId,
    agentName: plan.agentName,
    agentDir: plan.agentDir,
    now: plan.createdAt,
  });

  try {
    await mkdir(dirname(paths.outputPath), { recursive: true });
    const childOutput = await readOptionalText(plan.paths.outputPath);
    const output = childOutput ?? input.fallbackOutput;

    const inputContent = await readOptionalText(plan.paths.inputPath);
    if (inputContent !== undefined) await writeTextArtifact(paths.inputPath, inputContent);
    await writeTextArtifact(paths.outputPath, output);
    await writeTextArtifact(paths.jsonlPath, formatJsonl(input.jsonlLines));
    await writeJsonArtifact(paths.metadataPath, {
      ...input.metadata,
      artifactSessionId: sessionId,
      artifactCreatedAt: plan.createdAt.toISOString(),
      usedChildOutputFile: childOutput !== undefined,
      outputBytes: Buffer.byteLength(output, "utf8"),
      outputLines: countLines(output),
    });

    if (paths.outputPath !== plan.paths.outputPath) {
      await rm(getAgentSessionArtifactRoot(plan.sessionId, plan.agentDir), { recursive: true, force: true });
    }

    return { ok: true, paths, output, usedChildOutputFile: childOutput !== undefined };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function writeTextArtifact(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await withFileMutationQueue(filePath, async () => {
    await writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
  });
}

async function writeJsonArtifact(filePath: string, value: unknown): Promise<void> {
  await writeTextArtifact(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function readOptionalText(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw error;
  }
}

function formatJsonl(lines: string[]): string {
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

function countLines(text: string): number {
  if (!text) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

function getAgentSessionArtifactRoot(sessionId: string, agentDir: string): string {
  return join(agentDir, ARTIFACT_ROOT_DIR, safeArtifactSegment(sessionId));
}

function artifactTimestamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[^0-9A-Za-z]+/g, "-")
    .replace(/-+$/g, "");
}

function safeArtifactSegment(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^0-9A-Za-z._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "unknown";
}
