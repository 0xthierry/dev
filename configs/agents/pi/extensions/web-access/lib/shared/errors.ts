export type ErrorPhase = "validation" | "search" | "fetch" | "retrieve" | "storage" | "github" | "video";

export type WebAccessError = {
  code: string;
  message: string;
  phase: ErrorPhase;
  whatHappened: string;
  suggestedAction: string;
  retriable: boolean;
  cause?: string;
  input?: Record<string, unknown>;
};

export function isWebAccessError(value: unknown): value is WebAccessError {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.code === "string" &&
    typeof record.message === "string" &&
    typeof record.phase === "string" &&
    typeof record.whatHappened === "string" &&
    typeof record.suggestedAction === "string" &&
    typeof record.retriable === "boolean"
  );
}

export function formatWebAccessError(error: WebAccessError): string {
  return [
    `Error: ${error.message}`,
    "",
    `What happened: ${error.whatHappened}`,
    `What to do next: ${error.suggestedAction}`,
  ].join("\n");
}

export function unknownCause(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

export function isAbortError(value: unknown): boolean {
  return unknownCause(value).toLowerCase().includes("abort");
}

export function noSearchQueryError(input: Record<string, unknown>): WebAccessError {
  return {
    code: "NO_QUERY_PROVIDED",
    message: "No search query provided.",
    phase: "validation",
    whatHappened: "web_search needs either query for one search or queries for multiple searches.",
    suggestedAction: "Retry with query for one focused search, or queries for multiple research angles.",
    retriable: false,
    input,
  };
}

export function noFetchUrlError(input: Record<string, unknown>): WebAccessError {
  return {
    code: "NO_URL_PROVIDED",
    message: "No URL provided.",
    phase: "validation",
    whatHappened: "fetch_content needs either url for one target or urls for a batch.",
    suggestedAction: "Retry with url for one page/video/repository, or urls for multiple targets.",
    retriable: false,
    input,
  };
}

export function searchFailedError(cause: string, input: Record<string, unknown> = {}): WebAccessError {
  return {
    code: "SEARCH_FAILED",
    message: "Web search failed.",
    phase: "search",
    whatHappened: "The search provider could not return usable results for this query.",
    suggestedAction: "Retry with a different query, fewer filters, or a narrower domain/source target.",
    retriable: true,
    cause,
    input,
  };
}

export function searchAbortedError(cause: string, input: Record<string, unknown> = {}): WebAccessError {
  return {
    code: "SEARCH_ABORTED",
    message: "The search was aborted.",
    phase: "search",
    whatHappened: "The search operation was cancelled before completion.",
    suggestedAction: "Retry the search if the information is still needed.",
    retriable: true,
    cause,
    input,
  };
}

export function invalidUrlError(url: string): WebAccessError {
  return {
    code: "INVALID_URL",
    message: "The URL is invalid.",
    phase: "validation",
    whatHappened: "The provided value could not be parsed as a fully formed URL.",
    suggestedAction: "Retry with a complete URL including the scheme, such as https://example.com/page.",
    retriable: false,
    cause: "Invalid URL",
    input: { url },
  };
}

export function pdfUnsupportedError(url: string): WebAccessError {
  return {
    code: "PDF_UNSUPPORTED",
    message: "PDF files are unsupported by this extension.",
    phase: "fetch",
    whatHappened: "The requested URL points to a PDF document, which this extension does not read.",
    suggestedAction: "Use another PDF-capable tool, or ask the user for an HTML/text version of the source.",
    retriable: false,
    cause: "PDF unsupported by this extension.",
    input: { url },
  };
}

export function localVideoUnsupportedError(url: string): WebAccessError {
  return {
    code: "LOCAL_VIDEO_UNSUPPORTED",
    message: "Local video files are unsupported by this extension.",
    phase: "video",
    whatHappened: "The requested URL points to a local video file, which this extension does not process.",
    suggestedAction: "Use a supported remote video URL, or ask the user to provide relevant frames or transcript text.",
    retriable: false,
    cause: "Local video unsupported by this extension.",
    input: { url },
  };
}

export function timestampRequiresYouTubeError(url: string): WebAccessError {
  return {
    code: "TIMESTAMP_REQUIRES_YOUTUBE",
    message: "Timestamp and frame extraction only work with YouTube URLs.",
    phase: "validation",
    whatHappened: "A timestamp or frame count was provided for a non-YouTube URL.",
    suggestedAction: "Remove timestamp/frames for normal page fetches, or provide a YouTube URL.",
    retriable: false,
    cause: "Timestamp/frame extraction only works with YouTube URLs in this extension.",
    input: { url },
  };
}

export function authRequiredError(url: string, cause: string): WebAccessError {
  return {
    code: "AUTH_REQUIRED",
    message: "Authentication is required to complete this request.",
    phase: cause.toLowerCase().includes("youtube") || cause.toLowerCase().includes("video") ? "video" : "fetch",
    whatHappened: "The content could not be accessed with the currently available authentication state.",
    suggestedAction:
      "Ask the user to sign in or provide an accessible URL; for videos, try a timestamp/frame request if visual evidence is enough.",
    retriable: true,
    cause,
    input: { url },
  };
}

export function contentTooLargeError(url: string, cause: string): WebAccessError {
  return {
    code: "CONTENT_TOO_LARGE",
    message: "The response is too large to fetch directly.",
    phase: "fetch",
    whatHappened: "The server reported content larger than this extension will download inline.",
    suggestedAction: "Fetch a narrower URL, use a source-specific tool, or ask for the exact section needed.",
    retriable: false,
    cause,
    input: { url },
  };
}

export function unsupportedContentTypeError(url: string, cause: string): WebAccessError {
  return {
    code: "UNSUPPORTED_CONTENT_TYPE",
    message: "The URL returned an unsupported content type.",
    phase: "fetch",
    whatHappened: "The content is not readable page text, repository content, or supported video content.",
    suggestedAction: "Use a text/HTML page URL, a supported repository URL, or another tool for this media/file type.",
    retriable: false,
    cause,
    input: { url },
  };
}

export function githubCloneFailedError(url: string, cause: string): WebAccessError {
  return {
    code: "GITHUB_CLONE_FAILED",
    message: "GitHub repository retrieval failed.",
    phase: "github",
    whatHappened: "The repository could not be cloned or accessed from the current environment.",
    suggestedAction:
      "Check that the repository is public or accessible, retry the root repository URL, or use a specific file URL.",
    retriable: true,
    cause,
    input: { url },
  };
}

export function abortedError(url: string): WebAccessError {
  return {
    code: "ABORTED",
    message: "The request was aborted.",
    phase: "fetch",
    whatHappened: "The operation was cancelled before completion.",
    suggestedAction: "Retry if the information is still needed.",
    retriable: true,
    cause: "Aborted",
    input: { url },
  };
}

export function fetchFailedError(url: string, cause: string): WebAccessError {
  return {
    code: "FETCH_FAILED",
    message: "Content extraction failed.",
    phase: "fetch",
    whatHappened: "The URL could not be fetched or converted into useful readable content.",
    suggestedAction: "Retry with a more specific or accessible URL, or use web_search to find another source.",
    retriable: true,
    cause,
    input: { url },
  };
}

export function storedResultNotFoundError(responseId: string): WebAccessError {
  return {
    code: "STORED_RESULT_NOT_FOUND",
    message: "Stored result not found.",
    phase: "retrieve",
    whatHappened: `responseId "${responseId}" is not available in the current session or has expired.`,
    suggestedAction: "Re-run web_search or fetch_content, then use the new responseId/searchId/fetchId.",
    retriable: false,
    input: { responseId },
  };
}

export function queryIndexOutOfRangeError(responseId: string, queryIndex: number, queryCount: number): WebAccessError {
  return {
    code: "QUERY_INDEX_OUT_OF_RANGE",
    message: "Search query index out of range.",
    phase: "retrieve",
    whatHappened: `queryIndex ${queryIndex} is outside the stored query range 0-${queryCount - 1}.`,
    suggestedAction:
      "Retry with a queryIndex shown in the stored result range, or omit queryIndex for the first query.",
    retriable: false,
    input: { responseId, queryIndex, queryCount },
  };
}

export function storedQueryFailedError(
  responseId: string,
  queryIndex: number,
  query: string,
  cause: string,
): WebAccessError {
  return {
    code: "STORED_QUERY_FAILED",
    message: "Stored search query failed.",
    phase: "search",
    whatHappened: `The stored query "${query}" ended with an error instead of search results.`,
    suggestedAction: "Retry web_search for this query or use a different query/source filter.",
    retriable: true,
    cause,
    input: { responseId, queryIndex, query },
  };
}

export function storedUrlNotFoundError(
  responseId: string,
  url: string | undefined,
  urlIndex: number | undefined,
  urlCount: number,
): WebAccessError {
  const index = urlIndex ?? 0;
  return {
    code: "STORED_URL_NOT_FOUND",
    message: "URL not found in stored content.",
    phase: "retrieve",
    whatHappened: url
      ? `The exact URL "${url}" is not present in this stored result.`
      : `urlIndex ${index} is outside the stored URL range 0-${urlCount - 1}.`,
    suggestedAction: "Retry with a listed URL/urlIndex from the batch, or re-run fetch_content for the desired URL.",
    retriable: false,
    input: { responseId, url, urlIndex, urlCount },
  };
}

export function invalidStoredDataError(responseId: string, storedType: string): WebAccessError {
  return {
    code: "INVALID_STORED_DATA",
    message: "Invalid stored data format.",
    phase: "storage",
    whatHappened: "The stored response did not match a search or fetch result shape.",
    suggestedAction: "Re-run web_search or fetch_content to create a fresh stored result.",
    retriable: false,
    input: { responseId, storedType },
  };
}
