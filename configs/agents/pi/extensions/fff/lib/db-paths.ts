import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export type FffDbPaths = {
  frecencyDbPath?: string;
  historyDbPath?: string;
};

export type FffDbPathResolver = (cwd: string) => FffDbPaths;

export type FffDbPathResolverOptions = {
  frecencyDbPathOverride?: string;
  historyDbPathOverride?: string;
  cacheHome?: string;
};

export function createFffDbPathResolver(options: FffDbPathResolverOptions = {}): FffDbPathResolver {
  const frecencyOverride = nonEmptyString(options.frecencyDbPathOverride);
  const historyOverride = nonEmptyString(options.historyDbPathOverride);
  const cacheHome = options.cacheHome ?? defaultCacheHome();

  return (cwd: string): FffDbPaths => {
    const projectPaths = createProjectDbPaths(cwd, cacheHome);
    return {
      frecencyDbPath: frecencyOverride ?? projectPaths.frecencyDbPath,
      historyDbPath: historyOverride ?? projectPaths.historyDbPath,
    };
  };
}

export function createProjectDbPaths(cwd: string, cacheHome = defaultCacheHome()): Required<FffDbPaths> {
  const projectRoot = findProjectRoot(cwd);
  const projectDir = join(cacheHome, "pi", "fff", "projects", projectCacheKey(projectRoot));

  return {
    frecencyDbPath: join(projectDir, "frecency.sqlite"),
    historyDbPath: join(projectDir, "history.sqlite"),
  };
}

export function findProjectRoot(cwd: string): string {
  const start = canonicalizeDir(cwd);
  let current = start;

  while (true) {
    if (existsSync(join(current, ".git"))) return current;

    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

export function projectCacheKey(projectRoot: string): string {
  const canonicalRoot = canonicalizeDir(projectRoot);
  const label = safeCacheSegment(basename(canonicalRoot) || "root");
  const hash = createHash("sha256").update(canonicalRoot).digest("hex").slice(0, 16);
  return `${label}-${hash}`;
}

function defaultCacheHome(): string {
  return process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
}

function canonicalizeDir(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function safeCacheSegment(value: string): string {
  const safe = value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe || "project";
}

function nonEmptyString(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}
