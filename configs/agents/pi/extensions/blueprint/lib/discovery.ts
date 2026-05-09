import { type Dirent, existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { normalizeBlueprintDefinition } from "./definition";
import type { BlueprintDiscoveryError, BlueprintDiscoveryResult, BlueprintScope, LoadedBlueprint } from "./types";

export interface BlueprintDiscoveryOptions {
  userDirs?: string[];
  projectDirs?: string[];
}

interface BlueprintCandidate {
  filePath: string;
  scope: BlueprintScope;
}

interface BlueprintDir {
  path: string;
  scope: BlueprintScope;
}

export async function discoverBlueprints(
  cwd: string,
  options: BlueprintDiscoveryOptions = {},
): Promise<BlueprintDiscoveryResult> {
  const scopedDirs = uniqueScopedDirs([
    ...(options.userDirs ?? defaultUserBlueprintDirs()).map((path) => ({ path, scope: "user" as const })),
    ...(options.projectDirs ?? defaultProjectBlueprintDirs(cwd)).map((path) => ({ path, scope: "project" as const })),
  ]);
  const dirs = scopedDirs.map((dir) => dir.path);
  const candidates = await findBlueprintCandidates(scopedDirs);
  const blueprints: LoadedBlueprint[] = [];
  const errors: BlueprintDiscoveryError[] = [];
  const seenIds = new Set<string>();

  for (const candidate of candidates) {
    const loaded = await loadBlueprintCandidate(candidate);
    if (!loaded.ok) {
      errors.push({ filePath: candidate.filePath, message: loaded.error });
      continue;
    }

    const id = `${loaded.blueprint.scope}/${loaded.blueprint.name}`;
    if (seenIds.has(id)) {
      errors.push({ filePath: candidate.filePath, message: `Duplicate blueprint id '${id}' ignored.` });
      continue;
    }

    seenIds.add(id);
    blueprints.push({ ...loaded.blueprint, id });
  }

  return {
    dirs,
    blueprints: blueprints.sort((a, b) => a.id.localeCompare(b.id)),
    errors,
  };
}

export function defaultUserBlueprintDirs(agentDir = getAgentDir()): string[] {
  const piDir = dirname(agentDir);
  return [join(agentDir, "blueprints"), join(piDir, "blueprint"), join(piDir, "blueprints")];
}

export function defaultProjectBlueprintDirs(cwd: string): string[] {
  const dirs: string[] = [];
  let current = cwd;

  while (true) {
    for (const name of ["blueprint", "blueprints"]) {
      const candidate = join(current, ".pi", name);
      if (existsSync(candidate)) dirs.push(candidate);
    }

    const parent = dirname(current);
    if (parent === current) return dirs;
    current = parent;
  }
}

async function findBlueprintCandidates(dirs: BlueprintDir[]): Promise<BlueprintCandidate[]> {
  const candidates: BlueprintCandidate[] = [];

  for (const dir of dirs) {
    let entries: Dirent[];
    try {
      entries = await readdir(dir.path, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = join(dir.path, entry.name);
      if (entry.name.startsWith(".")) continue;
      if (entry.isFile() && entry.name.endsWith(".json")) candidates.push({ scope: dir.scope, filePath: entryPath });
      if (entry.isDirectory()) {
        const nestedPath = join(entryPath, "blueprint.json");
        if (existsSync(nestedPath)) candidates.push({ scope: dir.scope, filePath: nestedPath });
      }
    }
  }

  return candidates.sort((a, b) => a.filePath.localeCompare(b.filePath));
}

async function loadBlueprintCandidate(
  candidate: BlueprintCandidate,
): Promise<{ ok: true; blueprint: Omit<LoadedBlueprint, "id"> } | { ok: false; error: string }> {
  let raw: string;
  try {
    raw = await readFile(candidate.filePath, "utf8");
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    return { ok: false, error: `Invalid JSON: ${errorMessage(error)}` };
  }

  const normalized = normalizeBlueprintDefinition(parsed);
  if (!normalized.ok) return { ok: false, error: normalized.errors.join(" ") };

  return {
    ok: true,
    blueprint: {
      name: normalized.definition.name,
      description: normalized.definition.description,
      scope: candidate.scope,
      filePath: candidate.filePath,
      dir: dirname(candidate.filePath),
      definition: normalized.definition,
    },
  };
}

function uniqueScopedDirs(dirs: BlueprintDir[]): BlueprintDir[] {
  const seen = new Set<string>();
  const result: BlueprintDir[] = [];
  for (const dir of dirs) {
    if (seen.has(dir.path)) continue;
    seen.add(dir.path);
    result.push(dir);
  }
  return result;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Unknown error";
}
