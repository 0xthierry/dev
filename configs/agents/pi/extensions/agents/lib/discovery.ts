import { existsSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { AgentsContextDiscovery, AgentsContextFile, AgentsPathTarget, AgentsSession } from "./types";

const CONTEXT_FILE_NAMES = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"] as const;

export async function discoverAgentsSession(cwd: string): Promise<AgentsSession> {
  const resolvedCwd = resolve(cwd);
  const projectRoot = findProjectRoot(resolvedCwd);
  const diagnostics: string[] = [];
  const nativeFiles = await discoverContextFilesInDirs(
    ancestorDirs(projectRoot, resolvedCwd),
    projectRoot,
    diagnostics,
  );
  return { projectRoot, nativeFiles, diagnostics };
}

export async function discoverAgentsContextForTarget(
  session: AgentsSession,
  cwd: string,
  target: AgentsPathTarget,
): Promise<AgentsContextDiscovery> {
  const targetDir = await resolveTargetDirectory(cwd, target);
  if (!targetDir || !isUnderOrEqual(session.projectRoot, targetDir)) return { files: [], diagnostics: [] };

  const diagnostics: string[] = [];
  const files = await discoverContextFilesInDirs(
    ancestorDirs(session.projectRoot, targetDir),
    session.projectRoot,
    diagnostics,
  );
  return { files, diagnostics };
}

export function findProjectRoot(cwd: string): string {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(resolve(current, ".git"))) return current;
    const parent = resolve(current, "..");
    if (parent === current) return cwd;
    current = parent;
  }
}

export function displayPath(root: string, path: string): string {
  const relativePath = relative(root, path).split(sep).join("/");
  if (relativePath && !relativePath.startsWith("..") && !isAbsolute(relativePath)) return relativePath;
  return path.split(sep).join("/");
}

export function normalizeInputPath(path: string): string {
  return path
    .trim()
    .replace(/^@+/, "")
    .replace(/[),.;:!?]+$/g, "")
    .replace(/:(\d+)(:\d+)?$/g, "")
    .replace(/\\/g, "/");
}

async function discoverContextFilesInDirs(
  dirs: string[],
  projectRoot: string,
  diagnostics: string[],
): Promise<AgentsContextFile[]> {
  const files: AgentsContextFile[] = [];
  const seenKeys = new Set<string>();

  for (const dir of dirs) {
    const file = await loadContextFileFromDir(dir, projectRoot, diagnostics);
    if (!file || seenKeys.has(file.key)) continue;
    seenKeys.add(file.key);
    files.push(file);
  }

  return files;
}

async function loadContextFileFromDir(
  dir: string,
  projectRoot: string,
  diagnostics: string[],
): Promise<AgentsContextFile | undefined> {
  for (const filename of CONTEXT_FILE_NAMES) {
    const path = resolve(dir, filename);
    if (!existsSync(path)) continue;

    try {
      const stats = await stat(path);
      if (!stats.isFile()) continue;
      return {
        key: await canonicalPath(path),
        path,
        relativePath: displayPath(projectRoot, path),
        filename,
        content: await readFile(path, "utf8"),
      };
    } catch (error) {
      diagnostics.push(`Could not read ${path}: ${errorMessage(error)}`);
    }
  }

  return undefined;
}

async function resolveTargetDirectory(cwd: string, target: AgentsPathTarget): Promise<string | undefined> {
  const normalized = normalizeInputPath(target.path);
  if (!normalized || looksLikeUrl(normalized)) return undefined;

  const absolutePath = isAbsolute(normalized) ? resolve(normalized) : resolve(cwd, normalized);
  if (target.kind === "directory") return absolutePath;
  if (target.kind === "file") return dirname(absolutePath);

  try {
    const stats = await stat(absolutePath);
    if (stats.isDirectory()) return absolutePath;
  } catch {
    // Missing paths are treated as files so writes to new files can still load context from existing parents.
  }

  return dirname(absolutePath);
}

function ancestorDirs(root: string, targetDir: string): string[] {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(targetDir);
  if (!isUnderOrEqual(resolvedRoot, resolvedTarget)) return [];

  const dirs = [resolvedRoot];
  let current = resolvedRoot;
  while (current !== resolvedTarget) {
    const relativeChild = relative(current, resolvedTarget).split(sep)[0];
    if (!relativeChild) break;
    current = resolve(current, relativeChild);
    dirs.push(current);
  }
  return dirs;
}

function isUnderOrEqual(root: string, path: string): boolean {
  const relativePath = relative(resolve(root), resolve(path));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function looksLikeUrl(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(path);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
