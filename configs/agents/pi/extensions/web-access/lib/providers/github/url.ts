const NON_CODE_SEGMENTS = new Set([
  "issues",
  "pull",
  "pulls",
  "discussions",
  "releases",
  "wiki",
  "actions",
  "settings",
  "security",
  "projects",
  "graphs",
  "compare",
  "commits",
]);

export interface GitHubUrlInfo {
  owner: string;
  repo: string;
  ref?: string;
  path?: string;
  type: "root" | "blob" | "tree";
  refIsFullSha: boolean;
}

const SAFE_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const SAFE_REPO_PATTERN = /^[A-Za-z0-9._-]+$/;
const SAFE_REF_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_REPO_NAME_LENGTH = 100;
const MAX_REF_LENGTH = 255;

function decodePathSegment(rawSegment: string): string | null {
  try {
    const segment = decodeURIComponent(rawSegment);
    if (!isSafePathSegment(segment)) return null;
    return segment;
  } catch {
    return null;
  }
}

function hasUnsafePathChars(segment: string): boolean {
  for (const char of segment) {
    const charCode = char.charCodeAt(0);
    if (char === "/" || char === "\\" || charCode <= 31 || charCode === 127) return true;
  }
  return false;
}

function isSafePathSegment(segment: string): boolean {
  return segment.length > 0 && segment !== "." && segment !== ".." && !hasUnsafePathChars(segment);
}

function parsePathSegments(pathname: string): string[] | null {
  const rawSegments = pathname.split("/").filter(Boolean);
  const segments: string[] = [];
  for (const rawSegment of rawSegments) {
    const segment = decodePathSegment(rawSegment);
    if (!segment) return null;
    segments.push(segment);
  }
  return segments;
}

function isSafeOwner(owner: string): boolean {
  return SAFE_OWNER_PATTERN.test(owner);
}

function isSafeRepo(repo: string): boolean {
  return repo.length <= MAX_REPO_NAME_LENGTH && SAFE_REPO_PATTERN.test(repo) && isSafePathSegment(repo);
}

function isSafeRef(ref: string): boolean {
  return ref.length <= MAX_REF_LENGTH && SAFE_REF_PATTERN.test(ref) && isSafePathSegment(ref);
}

export function parseGitHubUrl(url: string): GitHubUrlInfo | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") return null;
  const segments = parsePathSegments(parsed.pathname);
  if (!segments || segments.length < 2) return null;
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, "");
  if (!isSafeOwner(owner) || !isSafeRepo(repo)) return null;
  if (NON_CODE_SEGMENTS.has(segments[2]?.toLowerCase())) return null;
  if (segments.length === 2) return { owner, repo, type: "root", refIsFullSha: false };
  const action = segments[2];
  const ref = segments[3];
  if ((action !== "blob" && action !== "tree") || !ref || !isSafeRef(ref)) return null;
  return {
    owner,
    repo,
    type: action,
    ref,
    refIsFullSha: /^[0-9a-f]{40}$/.test(ref),
    path: segments.slice(4).join("/"),
  };
}

export function gitHubCacheKey(info: GitHubUrlInfo): string {
  return `${info.owner}/${info.repo}${info.ref ? `@${info.ref}` : ""}`;
}
