import { execFile } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  loadConfig,
  normalizedBoolean,
  normalizedPositiveNumber,
  normalizedString,
  type WebSearchConfig,
} from "../../config";
import { execFileText } from "../../shared/process";
import { type GitHubUrlInfo, gitHubCacheKey } from "./url";

export interface GitHubConfig {
  enabled: boolean;
  maxRepoSizeMB: number;
  cloneTimeoutSeconds: number;
  clonePath: string;
}

const DEFAULT_GITHUB_CLONE_PATH = "/tmp/pi-github-repos";

const cloneCache = new Map<string, Promise<string | null>>();

export function normalizeGitHubConfig(raw: WebSearchConfig["githubClone"] = {}): GitHubConfig {
  return {
    enabled: normalizedBoolean(raw.enabled, true),
    maxRepoSizeMB: normalizedPositiveNumber(raw.maxRepoSizeMB, 350),
    cloneTimeoutSeconds: normalizedPositiveNumber(raw.cloneTimeoutSeconds, 30),
    clonePath: normalizedString(raw.clonePath) ?? DEFAULT_GITHUB_CLONE_PATH,
  };
}

export function githubConfig(): GitHubConfig {
  return normalizeGitHubConfig(loadConfig().githubClone);
}

function cloneDir(cfg: GitHubConfig, info: GitHubUrlInfo): string {
  return join(cfg.clonePath, info.owner, info.ref ? `${info.repo}@${info.ref}` : info.repo);
}

function execClone(args: string[], localPath: string, timeoutMs: number, signal?: AbortSignal): Promise<string | null> {
  return new Promise((resolveResult) => {
    const child = execFile(args[0], args.slice(1), { timeout: timeoutMs }, (err) => {
      if (err) {
        rmSync(localPath, { recursive: true, force: true });
        resolveResult(null);
        return;
      }
      resolveResult(localPath);
    });
    if (signal) {
      const onAbort = () => child.kill();
      signal.addEventListener("abort", onAbort, { once: true });
      child.on("exit", () => signal.removeEventListener("abort", onAbort));
    }
  });
}

async function commandExists(command: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await execFileText(command, ["--version"], { timeout: 5000, signal });
    return true;
  } catch {
    return false;
  }
}

async function cloneRepo(info: GitHubUrlInfo, cfg: GitHubConfig, signal?: AbortSignal): Promise<string | null> {
  const localPath = cloneDir(cfg, info);
  rmSync(localPath, { recursive: true, force: true });
  mkdirSync(join(localPath, ".."), { recursive: true });
  const timeoutMs = cfg.cloneTimeoutSeconds * 1000;
  if (await commandExists("gh", signal)) {
    const args = [
      "gh",
      "repo",
      "clone",
      `${info.owner}/${info.repo}`,
      localPath,
      "--",
      "--depth",
      "1",
      "--single-branch",
    ];
    if (info.ref) args.push("--branch", info.ref);
    const ghClone = await execClone(args, localPath, timeoutMs, signal);
    if (ghClone) return ghClone;
  }
  const args = ["git", "clone", "--depth", "1", "--single-branch"];
  if (info.ref) args.push("--branch", info.ref);
  args.push(`https://github.com/${info.owner}/${info.repo}.git`, localPath);
  return execClone(args, localPath, timeoutMs, signal);
}

export async function getClonedRepo(
  info: GitHubUrlInfo,
  cfg: GitHubConfig,
  signal?: AbortSignal,
): Promise<string | null> {
  const key = gitHubCacheKey(info);
  let clonePromise = cloneCache.get(key);
  if (!clonePromise) {
    clonePromise = cloneRepo(info, cfg, signal);
    cloneCache.set(key, clonePromise);
  }
  const localPath = await clonePromise;
  if (!localPath) cloneCache.delete(key);
  return localPath;
}

export function clearCloneCache(): void {
  const cfg = githubConfig();
  for (const key of cloneCache.keys()) {
    const [ownerRepo, ref] = key.split("@");
    const [owner, repo] = ownerRepo.split("/");
    rmSync(join(cfg.clonePath, owner, ref ? `${repo}@${ref}` : repo), { recursive: true, force: true });
  }
  cloneCache.clear();
}
