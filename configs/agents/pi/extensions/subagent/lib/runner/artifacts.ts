import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";

const ARTIFACT_ROOT_DIR = "agent-sessions-artifacts";
const ARTIFACT_DIR = "artifacts";

export interface SaveAgentOutputArtifactInput {
  sessionId?: string;
  agentName: string;
  output: string;
  agentDir?: string;
  now?: Date;
}

export type SaveAgentOutputArtifactResult = { ok: true; path?: string } | { ok: false; error: string };

export function getAgentSessionArtifactDir(sessionId: string, agentDir = getAgentDir()): string {
  return join(agentDir, ARTIFACT_ROOT_DIR, safeArtifactSegment(sessionId), ARTIFACT_DIR);
}

export function getAgentOutputArtifactPath(input: {
  sessionId: string;
  agentName: string;
  agentDir?: string;
  now?: Date;
}): string {
  const dir = getAgentSessionArtifactDir(input.sessionId, input.agentDir);
  const timestamp = artifactTimestamp(input.now ?? new Date());
  return join(dir, `${timestamp}_${safeArtifactSegment(input.agentName)}_output.md`);
}

export async function saveAgentOutputArtifact(
  input: SaveAgentOutputArtifactInput,
): Promise<SaveAgentOutputArtifactResult> {
  const sessionId = input.sessionId?.trim();
  if (!sessionId || input.output.length === 0) return { ok: true };

  const filePath = getAgentOutputArtifactPath({
    sessionId,
    agentName: input.agentName,
    agentDir: input.agentDir,
    now: input.now,
  });

  try {
    await mkdir(getAgentSessionArtifactDir(sessionId, input.agentDir), { recursive: true });
    await withFileMutationQueue(filePath, async () => {
      await writeFile(filePath, input.output, { encoding: "utf8", mode: 0o600 });
    });
    return { ok: true, path: filePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
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
