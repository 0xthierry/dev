import { type Dirent, existsSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { classifyRule, parseRuleFile } from "./frontmatter";
import type { ProjectRule, RuleDiscoveryResult, RuleSource } from "./types";

const RULE_DIRECTORIES: Array<{ source: RuleSource; segments: string[] }> = [
  { source: ".pi/rules", segments: [".pi", "rules"] },
  { source: ".agents/rules", segments: [".agents", "rules"] },
  { source: ".claude/rules", segments: [".claude", "rules"] },
];

export async function discoverProjectRules(cwd: string): Promise<RuleDiscoveryResult> {
  const diagnostics: string[] = [];
  const projectRoot = findProjectRoot(resolve(cwd));
  const roots = ancestorDirs(projectRoot, resolve(cwd));
  const discovered = new Map<string, ProjectRule>();

  for (const root of roots) {
    for (const ruleDirectory of RULE_DIRECTORIES) {
      const directory = resolve(root, ...ruleDirectory.segments);
      if (!existsSync(directory)) continue;

      const files = await findRuleFiles(directory, diagnostics);
      for (const file of files) {
        const key = await canonicalRuleKey(file);
        const relativePath = displayPath(cwd, file);
        const existing = discovered.get(key);
        if (existing) {
          existing.aliases.push(relativePath);
          continue;
        }

        const parsed = parseRuleFile(await readFile(file, "utf8"));
        const mode = classifyRule(parsed.frontmatter);
        const patterns = [...parsed.frontmatter.paths, ...parsed.frontmatter.globs];
        discovered.set(key, {
          key,
          path: file,
          relativePath,
          aliases: [relativePath],
          source: ruleDirectory.source,
          name: ruleName(file),
          content: parsed.body,
          frontmatter: parsed.frontmatter,
          mode,
          patterns,
          description: parsed.frontmatter.description,
        });
      }
    }
  }

  return { rules: [...discovered.values()], diagnostics };
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

export function displayPath(cwd: string, path: string): string {
  const relativePath = relative(cwd, path).split(sep).join("/");
  if (!relativePath.startsWith("..") && relativePath !== "") return relativePath;
  return path.split(sep).join("/");
}

async function findRuleFiles(directory: string, diagnostics: string[]): Promise<string[]> {
  const results: string[] = [];
  const visitedDirectories = new Set<string>();

  async function walk(dir: string) {
    const directoryKey = await canonicalRuleKey(dir);
    if (visitedDirectories.has(directoryKey)) return;
    visitedDirectories.add(directoryKey);

    let entries: Dirent<string>[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      diagnostics.push(`Could not read rules directory ${dir}: ${errorMessage(error)}`);
      return;
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = resolve(dir, entry.name);
      let entryStat: Awaited<ReturnType<typeof stat>> | undefined;
      try {
        entryStat = await stat(path);
      } catch (error) {
        diagnostics.push(`Could not inspect rule path ${path}: ${errorMessage(error)}`);
        continue;
      }

      if (entryStat.isDirectory()) {
        await walk(path);
        continue;
      }

      if (entryStat.isFile() && isRuleFile(path)) {
        results.push(path);
      }
    }
  }

  await walk(directory);
  return results;
}

function ancestorDirs(root: string, cwd: string): string[] {
  const dirs = [root];
  let current = root;
  while (current !== cwd) {
    const relativeChild = relative(current, cwd).split(sep)[0];
    if (!relativeChild) break;
    current = resolve(current, relativeChild);
    dirs.push(current);
  }
  return dirs;
}

function isRuleFile(path: string): boolean {
  return path.endsWith(".md") || path.endsWith(".mdc");
}

async function canonicalRuleKey(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function ruleName(path: string): string {
  return (
    path
      .split(sep)
      .pop()
      ?.replace(/\.mdc?$/i, "") ?? path
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
