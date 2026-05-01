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

export function parseGitHubUrl(url: string): GitHubUrlInfo | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== "github.com" && parsed.hostname !== "www.github.com") return null;
  const segments = parsed.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  if (segments.length < 2) return null;
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/, "");
  if (NON_CODE_SEGMENTS.has(segments[2]?.toLowerCase())) return null;
  if (segments.length === 2) return { owner, repo, type: "root", refIsFullSha: false };
  const action = segments[2];
  if ((action !== "blob" && action !== "tree") || segments.length < 4) return null;
  return {
    owner,
    repo,
    type: action,
    ref: segments[3],
    refIsFullSha: /^[0-9a-f]{40}$/.test(segments[3]),
    path: segments.slice(4).join("/"),
  };
}

export function gitHubCacheKey(info: GitHubUrlInfo): string {
  return `${info.owner}/${info.repo}${info.ref ? `@${info.ref}` : ""}`;
}
