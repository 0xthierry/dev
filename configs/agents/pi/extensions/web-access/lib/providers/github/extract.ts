import { githubCloneFailedError } from "../../shared/errors";
import type { ExtractedContent } from "../../types";
import { getClonedRepo, githubConfig } from "./clone";
import { buildGitHubContent } from "./render";
import { parseGitHubUrl } from "./url";

export async function extractGitHub(
  url: string,
  signal?: AbortSignal,
  forceClone?: boolean,
): Promise<ExtractedContent | null> {
  const info = parseGitHubUrl(url);
  if (!info) return null;
  const cfg = githubConfig();
  if (!cfg.enabled) return null;
  if (info.refIsFullSha && !forceClone) {
    return {
      url,
      title: `${info.owner}/${info.repo}`,
      content:
        "Commit SHA GitHub URLs are not cloneable by this extension yet. Use gh/read tools or fetch the repository root.",
      error: null,
      provider: "github",
    };
  }
  const localPath = await getClonedRepo(info, cfg, signal);
  if (!localPath) {
    const cause = "GitHub clone failed. Ensure gh or git is installed and the repository is accessible.";
    return {
      url,
      title: `${info.owner}/${info.repo}`,
      content: "",
      error: cause,
      errorDetails: githubCloneFailedError(url, cause),
    };
  }
  return {
    url,
    title: info.path ? `${info.owner}/${info.repo} - ${info.path}` : `${info.owner}/${info.repo}`,
    content: buildGitHubContent(localPath, info),
    error: null,
    provider: "github",
  };
}
