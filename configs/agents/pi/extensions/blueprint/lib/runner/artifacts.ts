import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import type { BlueprintNodeResult, BlueprintRunResult, LoadedBlueprint } from "../types";

export interface BlueprintRunArtifacts {
  runId: string;
  runDir: string;
  contextFile: string;
  sessionsDir: string;
  nodeDir: (nodeId: string, attempt: number) => string;
  writeContext: (content: string) => Promise<void>;
  writeNodeResult: (result: BlueprintNodeResult) => Promise<void>;
  writeRunResult: (result: BlueprintRunResult) => Promise<void>;
}

export interface BlueprintArtifactOptions {
  rootDir?: string;
  now?: () => Date;
}

export async function createBlueprintRunArtifacts(
  blueprint: LoadedBlueprint,
  cwd: string,
  options: BlueprintArtifactOptions = {},
): Promise<BlueprintRunArtifacts> {
  const now = options.now ?? (() => new Date());
  const runId = buildRunId(now());
  const rootDir = options.rootDir ?? defaultBlueprintRunRoot(cwd);
  const runDir = join(rootDir, `${safePathPart(blueprint.name)}-${runId}`);
  const contextFile = join(runDir, "context.md");
  const sessionsDir = join(runDir, "sessions");

  await mkdir(sessionsDir, { recursive: true });

  return {
    runId,
    runDir,
    contextFile,
    sessionsDir,
    nodeDir: (nodeId, attempt) => join(runDir, "nodes", `${String(attempt).padStart(2, "0")}-${safePathPart(nodeId)}`),
    async writeContext(content) {
      await writeQueuedFile(contextFile, content);
    },
    async writeNodeResult(result) {
      const dir = join(runDir, "nodes", `${String(result.attempt).padStart(2, "0")}-${safePathPart(result.nodeId)}`);
      await mkdir(dir, { recursive: true });
      await writeQueuedFile(join(dir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
      if (result.stdout !== undefined) await writeQueuedFile(join(dir, "stdout.log"), result.stdout);
      if (result.stderr !== undefined) await writeQueuedFile(join(dir, "stderr.log"), result.stderr);
    },
    async writeRunResult(result) {
      await writeQueuedFile(join(runDir, "run.json"), `${JSON.stringify(result, null, 2)}\n`);
    },
  };
}

export function defaultBlueprintRunRoot(cwd: string, agentDir = getAgentDir()): string {
  return join(agentDir, "blueprint-runs", safePathPart(cwd));
}

export function buildRunId(date: Date): string {
  const iso = date.toISOString().replace(/[:.]/g, "-");
  return iso.replace(/Z$/, "Z");
}

function safePathPart(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "root";
}

async function writeQueuedFile(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await withFileMutationQueue(filePath, async () => {
    await writeFile(filePath, content, "utf8");
  });
}
