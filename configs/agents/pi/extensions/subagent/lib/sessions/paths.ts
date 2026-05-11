import { open, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface AgentSessionFileMatch {
  sessionId: string;
  sessionFile: string;
}

export type AgentSessionFileLookupResult =
  | { ok: true; match: AgentSessionFileMatch }
  | { ok: false; reason: "not-found" | "ambiguous"; matches: AgentSessionFileMatch[] };

const SESSION_HEADER_READ_BYTES = 4096;

export function getProjectAgentSessionDir(cwd: string, agentDir = getAgentDir()): string {
  return join(agentDir, "agent-sessions", encodeProjectCwd(cwd));
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

export async function findAgentSessionFileById(
  sessionDir: string,
  sessionIdOrPrefix: string,
): Promise<AgentSessionFileLookupResult> {
  const needle = sessionIdOrPrefix.trim();
  if (!needle) return { ok: false, reason: "not-found", matches: [] };

  let names: string[];
  try {
    names = await readdir(sessionDir);
  } catch {
    return { ok: false, reason: "not-found", matches: [] };
  }

  const matches: AgentSessionFileMatch[] = [];
  for (const name of names) {
    if (!name.endsWith(".jsonl")) continue;
    const sessionFile = join(sessionDir, name);
    const sessionId = await readSessionId(sessionFile);
    if (sessionId?.startsWith(needle)) matches.push({ sessionId, sessionFile });
  }

  if (matches.length === 1) return { ok: true, match: matches[0] };
  return { ok: false, reason: matches.length > 1 ? "ambiguous" : "not-found", matches };
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
