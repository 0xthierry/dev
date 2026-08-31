import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const SESSION_DIRECTORY = "subagent-sessions";
const ARTIFACT_DIRECTORY = "subagent-artifacts";

export function encodeProjectPath(cwd: string): string {
  const slug = resolve(cwd)
    .replace(/[\\/]+/g, "-")
    .replace(/[^0-9A-Za-z._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return `--${slug || "root"}--`;
}

export function getProjectSessionDirectory(cwd: string, agentDir = getAgentDir()): string {
  return join(agentDir, SESSION_DIRECTORY, encodeProjectPath(cwd));
}

export function getProjectArtifactDirectory(cwd: string, agentDir = getAgentDir()): string {
  return join(agentDir, ARTIFACT_DIRECTORY, encodeProjectPath(cwd));
}

export function getPrivateArtifactDirectory(cwd: string, artifactId: string, agentDir = getAgentDir()): string {
  if (!isArtifactId(artifactId)) throw new Error("Invalid artifact id");
  return join(getProjectArtifactDirectory(cwd, agentDir), artifactId);
}

export function artifactReference(artifactId: string): string {
  if (!isArtifactId(artifactId)) throw new Error("Invalid artifact id");
  return `subagent-artifact:${artifactId}`;
}

export function artifactIdFromReference(reference: string): string | undefined {
  const prefix = "subagent-artifact:";
  if (!reference.startsWith(prefix)) return undefined;
  const artifactId = reference.slice(prefix.length);
  return isArtifactId(artifactId) ? artifactId : undefined;
}

function isArtifactId(value: string): boolean {
  return /^[0-9a-f]{32}$/i.test(value);
}
