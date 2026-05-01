import { isYouTubeUrl } from "../providers/youtube/url";
import {
  invalidUrlError,
  localVideoUnsupportedError,
  pdfUnsupportedError,
  timestampRequiresYouTubeError,
  type WebAccessError,
} from "../shared/errors";
import type { ExtractedContent, FetchOptions } from "../types";

const LOCAL_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"]);

export type FetchTarget = {
  url: string;
  parsedUrl: URL;
  options: FetchOptions;
  youtube: { isYouTube: boolean; videoId: string | null };
  requestKind: "content" | "video-frames";
};

export type FetchTargetResult = { ok: true; target: FetchTarget } | { ok: false; result: ExtractedContent };

function errorResult(url: string, error: WebAccessError): ExtractedContent {
  return { url, title: "", content: "", error: error.cause ?? error.message, errorDetails: error };
}

export function hasFrameRequest(options: FetchOptions): boolean {
  return Boolean(options.frames || options.timestamp);
}

export function classifyFetchTarget(url: string, options: FetchOptions = {}): FetchTargetResult {
  const youtube = isYouTubeUrl(url);
  const wantsFrames = hasFrameRequest(options);

  if (wantsFrames && !(youtube.isYouTube && youtube.videoId)) {
    return { ok: false, result: errorResult(url, timestampRequiresYouTubeError(url)) };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, result: errorResult(url, invalidUrlError(url)) };
  }

  const lowerPath = parsedUrl.pathname.toLowerCase();
  if (lowerPath.endsWith(".pdf")) {
    return { ok: false, result: errorResult(url, pdfUnsupportedError(url)) };
  }
  if (
    parsedUrl.protocol === "file:" &&
    [...LOCAL_VIDEO_EXTENSIONS].some((extension) => lowerPath.endsWith(extension))
  ) {
    return { ok: false, result: errorResult(url, localVideoUnsupportedError(url)) };
  }

  return {
    ok: true,
    target: {
      url,
      parsedUrl,
      options,
      youtube,
      requestKind: wantsFrames ? "video-frames" : "content",
    },
  };
}
