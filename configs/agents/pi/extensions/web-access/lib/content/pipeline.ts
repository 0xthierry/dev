import pLimit from "p-limit";
import { fetchWithCodex } from "../providers/codex";
import { fetchWithExaContents } from "../providers/exa";
import { extractGitHub } from "../providers/github/extract";
import { fetchWithTavilyExtract } from "../providers/tavily";
import { extractYouTube, isYouTubeEnabled } from "../providers/youtube/transcript";
import { abortedError, authRequiredError, fetchFailedError, isAbortError } from "../shared/errors";
import type { ExtractedContent, FetchOptions } from "../types";
import { extractViaAuthenticatedHttp } from "./authenticated-http";
import { extractWithGeminiWeb } from "./gemini";
import { extractViaHttp } from "./http";
import { extractWithJinaReader } from "./jina";
import { classifyFetchTarget, type FetchTarget } from "./target";
import { extractYouTubeFrameRequest } from "./youtube-frames";

const CONCURRENT_LIMIT = 10;
const fetchLimit = pLimit(CONCURRENT_LIMIT);

type ExtractionOutcome =
  | { status: "success"; result: ExtractedContent }
  | { status: "terminal"; result: ExtractedContent }
  | { status: "failure"; result: ExtractedContent }
  | { status: "miss" };

export interface ContentExtractor {
  name: string;
  supports(target: FetchTarget): boolean;
  extract(target: FetchTarget, signal?: AbortSignal): Promise<ExtractionOutcome>;
}

function abortedResult(url: string): ExtractedContent {
  return { url, title: "", content: "", error: "Aborted", errorDetails: abortedError(url) };
}

function outcomeForResult(result: ExtractedContent | null, failureIsTerminal = false): ExtractionOutcome {
  if (!result) return { status: "miss" };
  if (!result.error) return { status: "success", result };
  return { status: failureIsTerminal ? "terminal" : "failure", result };
}

function httpOutcome(result: ExtractedContent): ExtractionOutcome {
  if (!result.error) return { status: "success", result };
  const terminalCodes = new Set(["PDF_UNSUPPORTED", "CONTENT_TOO_LARGE", "UNSUPPORTED_CONTENT_TYPE"]);
  if (result.errorDetails && terminalCodes.has(result.errorDetails.code)) return { status: "terminal", result };
  return { status: "failure", result };
}

function appendFallbackFailure(result: ExtractedContent): ExtractedContent {
  const error = `${result.error}\n\nFallbacks failed. Check page accessibility or Gemini/Codex configuration.`;
  return {
    ...result,
    error,
    errorDetails: fetchFailedError(result.url, error),
  };
}

export function createDefaultContentExtractors(): ContentExtractor[] {
  return [
    githubExtractor,
    youtubeTranscriptExtractor,
    authenticatedHttpExtractor,
    exaContentsExtractor,
    tavilyExtractExtractor,
    httpExtractor,
    jinaReaderExtractor,
    geminiWebExtractor,
    codexExtractor,
  ];
}

const githubExtractor: ContentExtractor = {
  name: "github",
  supports: (target) => target.requestKind === "content",
  async extract(target, signal) {
    try {
      return outcomeForResult(await extractGitHub(target.url, signal, target.options.forceClone), true);
    } catch (err) {
      if (isAbortError(err)) return { status: "terminal", result: abortedResult(target.url) };
      return { status: "miss" };
    }
  },
};

const youtubeTranscriptExtractor: ContentExtractor = {
  name: "youtube-transcript",
  supports: (target) => target.requestKind === "content" && target.youtube.isYouTube && isYouTubeEnabled(),
  async extract(target, signal) {
    try {
      const youtube = await extractYouTube(target.url, signal, target.options.prompt, target.options.model);
      if (youtube) return { status: "success", result: youtube };
    } catch (err) {
      if (isAbortError(err)) return { status: "terminal", result: abortedResult(target.url) };
    }
    const message = "Could not extract YouTube video content. Sign into gemini.google.com in Brave or Chromium.";
    return {
      status: "terminal",
      result: {
        url: target.url,
        title: "",
        content: "",
        error: message,
        errorDetails: authRequiredError(target.url, message),
      },
    };
  },
};

const authenticatedHttpExtractor: ContentExtractor = {
  name: "authenticated-http",
  supports: (target) => target.requestKind === "content",
  async extract(target, signal) {
    const result = await extractViaAuthenticatedHttp(target, signal);
    return result ? httpOutcome(result) : { status: "miss" };
  },
};

const exaContentsExtractor: ContentExtractor = {
  name: "exa-contents",
  supports: (target) => target.requestKind === "content",
  async extract(target, signal) {
    try {
      return outcomeForResult(await fetchWithExaContents(target.url, signal));
    } catch (err) {
      if (isAbortError(err)) return { status: "terminal", result: abortedResult(target.url) };
      return { status: "miss" };
    }
  },
};

const tavilyExtractExtractor: ContentExtractor = {
  name: "tavily-extract",
  supports: (target) => target.requestKind === "content",
  async extract(target, signal) {
    try {
      return outcomeForResult(await fetchWithTavilyExtract(target.url, target.options.prompt, signal));
    } catch (err) {
      if (isAbortError(err)) return { status: "terminal", result: abortedResult(target.url) };
      return { status: "miss" };
    }
  },
};

const httpExtractor: ContentExtractor = {
  name: "http",
  supports: (target) => target.requestKind === "content",
  async extract(target, signal) {
    return httpOutcome(await extractViaHttp(target.url, signal));
  },
};

const jinaReaderExtractor: ContentExtractor = {
  name: "jina-reader",
  supports: (target) => target.requestKind === "content",
  async extract(target, signal) {
    return outcomeForResult(await extractWithJinaReader(target.url, signal));
  },
};

const geminiWebExtractor: ContentExtractor = {
  name: "gemini-web",
  supports: (target) => target.requestKind === "content",
  async extract(target, signal) {
    return outcomeForResult(await extractWithGeminiWeb(target.url, signal));
  },
};

const codexExtractor: ContentExtractor = {
  name: "codex",
  supports: (target) => target.requestKind === "content",
  async extract(target, signal) {
    try {
      return outcomeForResult(await fetchWithCodex(target.url, target.options.prompt, { signal }));
    } catch (err) {
      if (isAbortError(err)) return { status: "terminal", result: abortedResult(target.url) };
      return { status: "miss" };
    }
  },
};

export async function extractContent(
  url: string,
  signal?: AbortSignal,
  options: FetchOptions = {},
  extractors: ContentExtractor[] = createDefaultContentExtractors(),
): Promise<ExtractedContent> {
  if (signal?.aborted) return abortedResult(url);

  const classified = classifyFetchTarget(url, options);
  if (!classified.ok) return classified.result;
  const target = { ...classified.target, options: { ...options, signal: options.signal ?? signal } };

  if (target.requestKind === "video-frames" && target.youtube.videoId) {
    return extractYouTubeFrameRequest(target.url, target.youtube.videoId, target.options);
  }

  let fallbackFailure: ExtractedContent | null = null;
  for (const extractor of extractors) {
    if (!extractor.supports(target)) continue;
    const outcome = await extractor.extract(target, signal);
    if (outcome.status === "success" || outcome.status === "terminal") return outcome.result;
    if (outcome.status === "failure" && !fallbackFailure) fallbackFailure = outcome.result;
  }

  if (fallbackFailure) return appendFallbackFailure(fallbackFailure);
  const message = "Content extraction failed.";
  return { url, title: "", content: "", error: message, errorDetails: fetchFailedError(url, message) };
}

export async function fetchAllContent(
  urls: string[],
  signal?: AbortSignal,
  options?: FetchOptions,
): Promise<ExtractedContent[]> {
  return Promise.all(urls.map((url) => fetchLimit(() => extractContent(url, signal, options))));
}
