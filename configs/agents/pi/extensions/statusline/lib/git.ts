import type { CommandRunner, GitChangeSummary, GitStatusSnapshot, PullRequestStatus } from "./types";

const GIT_TIMEOUT_MS = 2_000;
const GH_TIMEOUT_MS = 2_500;

const EMPTY_CHANGES: GitChangeSummary = {
  added: 0,
  removed: 0,
  changedFiles: 0,
  untrackedFiles: 0,
  binaryFiles: 0,
};

export async function loadGitStatus(
  runner: CommandRunner,
  cwd: string,
  signal?: AbortSignal,
): Promise<GitStatusSnapshot | null> {
  const root = await runCommand(runner, "git", ["rev-parse", "--show-toplevel"], cwd, GIT_TIMEOUT_MS, signal);
  if (root == null) return null;

  const [branch, statusOutput, numstatOutput] = await Promise.all([
    loadBranch(runner, root, signal),
    runCommand(runner, "git", ["status", "--porcelain=v1", "--untracked-files=normal"], root, GIT_TIMEOUT_MS, signal),
    runCommand(runner, "git", ["diff", "--numstat", "HEAD", "--"], root, GIT_TIMEOUT_MS, signal),
  ]);

  const pullRequest = await loadPullRequest(runner, root, branch, signal);
  const changes = summarizeChanges(statusOutput ?? "", numstatOutput ?? "");

  return { branch, pullRequest, changes };
}

export function summarizeChanges(statusOutput: string, numstatOutput: string): GitChangeSummary {
  const porcelain = parsePorcelainStatus(statusOutput);
  const numstat = parseNumstat(numstatOutput);

  return {
    added: numstat.added,
    removed: numstat.removed,
    changedFiles: porcelain.changedFiles,
    untrackedFiles: porcelain.untrackedFiles,
    binaryFiles: numstat.binaryFiles,
  };
}

export function hasChanges(changes: GitChangeSummary): boolean {
  return (
    changes.added > 0 ||
    changes.removed > 0 ||
    changes.changedFiles > 0 ||
    changes.untrackedFiles > 0 ||
    changes.binaryFiles > 0
  );
}

export function parsePullRequestFromBranch(branch: string | null): PullRequestStatus | null {
  if (!branch) return null;

  const patterns = [
    /(?:^|[/_-])pr[/_#-]?(\d+)(?=$|[/_-])/i,
    /(?:^|[/_-])pull[/_-]?(\d+)(?=$|[/_-])/i,
    /(?:^|[/_-])pull-request[/_-]?(\d+)(?=$|[/_-])/i,
    /(?:^|[/_-])#(\d+)(?=$|[/_-])/i,
  ];

  for (const pattern of patterns) {
    const match = branch.match(pattern);
    const number = match?.[1] ? Number(match[1]) : NaN;
    if (Number.isSafeInteger(number) && number > 0) return { number, source: "branch" };
  }

  return null;
}

export function parsePullRequestFromGh(stdout: string): PullRequestStatus | null {
  const json = parseJsonObject(stdout.trim());
  if (json) {
    const number = readPositiveInteger(json.number);
    if (number == null) return null;

    const url = readWebUrl(json.url);
    return url ? { number, source: "gh", url } : { number, source: "gh" };
  }

  const number = readPositiveInteger(stdout.trim());
  return number == null ? null : { number, source: "gh" };
}

export function parseGitHubRemoteUrl(remoteUrl: string): string | null {
  const normalized = remoteUrl.trim().replace(/\.git$/, "");
  const patterns = [
    /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)$/i,
    /^git@github\.com:([^/\s]+)\/([^/\s]+)$/i,
    /^ssh:\/\/git@github\.com\/([^/\s]+)\/([^/\s]+)$/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const owner = match?.[1];
    const repo = match?.[2];
    if (owner && repo) return `https://github.com/${owner}/${repo}`;
  }

  return null;
}

export function buildPullRequestUrl(remoteUrl: string, number: number): string | null {
  const repoUrl = parseGitHubRemoteUrl(remoteUrl);
  if (!repoUrl) return null;
  return `${repoUrl}/pull/${number}`;
}

function parsePorcelainStatus(output: string): Pick<GitChangeSummary, "changedFiles" | "untrackedFiles"> {
  let changedFiles = 0;
  let untrackedFiles = 0;

  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    if (line.startsWith("!!")) continue;
    if (line.startsWith("??")) {
      untrackedFiles++;
      continue;
    }
    changedFiles++;
  }

  return { changedFiles, untrackedFiles };
}

function parseNumstat(output: string): Pick<GitChangeSummary, "added" | "removed" | "binaryFiles"> {
  let added = 0;
  let removed = 0;
  let binaryFiles = 0;

  for (const line of output.split("\n")) {
    if (!line.trim()) continue;

    const [rawAdded, rawRemoved] = line.split("\t");
    if (rawAdded === "-" || rawRemoved === "-") {
      binaryFiles++;
      continue;
    }

    const addedCount = Number(rawAdded);
    const removedCount = Number(rawRemoved);
    if (Number.isFinite(addedCount) && addedCount > 0) added += addedCount;
    if (Number.isFinite(removedCount) && removedCount > 0) removed += removedCount;
  }

  return { added, removed, binaryFiles };
}

async function loadBranch(runner: CommandRunner, cwd: string, signal?: AbortSignal): Promise<string | null> {
  const branch = await runCommand(runner, "git", ["branch", "--show-current"], cwd, GIT_TIMEOUT_MS, signal);
  if (branch) return branch;

  const fallback = await runCommand(runner, "git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd, GIT_TIMEOUT_MS, signal);
  if (!fallback || fallback === "HEAD") return null;
  return fallback;
}

async function loadPullRequest(
  runner: CommandRunner,
  cwd: string,
  branch: string | null,
  signal?: AbortSignal,
): Promise<PullRequestStatus | null> {
  const ghOutput = await runCommand(runner, "gh", ["pr", "view", "--json", "number,url"], cwd, GH_TIMEOUT_MS, signal);
  const fromGh = ghOutput == null ? null : parsePullRequestFromGh(ghOutput);
  if (fromGh) return fromGh;

  const fromBranch = parsePullRequestFromBranch(branch);
  if (!fromBranch) return null;

  const remoteUrl = await runCommand(
    runner,
    "git",
    ["config", "--get", "remote.origin.url"],
    cwd,
    GIT_TIMEOUT_MS,
    signal,
  );
  const url = remoteUrl ? buildPullRequestUrl(remoteUrl, fromBranch.number) : null;
  return url ? { ...fromBranch, url } : fromBranch;
}

async function runCommand(
  runner: CommandRunner,
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const result = await runner.run(command, args, { cwd, signal, timeoutMs });
    if (result.code !== 0) return null;
    return result.stdout.trim();
  } catch {
    return null;
  }
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  if (!value.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readPositiveInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function readWebUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export { EMPTY_CHANGES };
