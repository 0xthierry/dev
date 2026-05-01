import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import {
  abortedError,
  contentTooLargeError,
  fetchFailedError,
  isAbortError,
  pdfUnsupportedError,
  unsupportedContentTypeError,
} from "../shared/errors";
import { extractHeadingTitle } from "../shared/text";
import type { ExtractedContent } from "../types";

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_USEFUL_CONTENT = 500;
const DEFAULT_HEADER_VALUE = "";
const DEFAULT_CONTENT_LENGTH_HEADER = "0";
const DEFAULT_ARTICLE_CONTENT = "";
const DEFAULT_ARTICLE_TITLE = "";
const MAX_SCOPED_HEADER_REDIRECTS = 10;
const DEFAULT_REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 AppleWebKit/537.36 Chrome/122 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.5",
  "Accept-Language": "en-US,en;q=0.9",
};
const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });

export interface HttpExtractOptions {
  headers?: Record<string, string>;
  isHeaderAllowedForUrl?: (url: URL) => boolean;
}

function headersForUrl(url: URL, options: HttpExtractOptions): Record<string, string> {
  const extraHeaders =
    options.headers && (!options.isHeaderAllowedForUrl || options.isHeaderAllowedForUrl(url)) ? options.headers : {};
  return { ...DEFAULT_REQUEST_HEADERS, ...extraHeaders };
}

async function fetchWithScopedHeaders(
  url: string,
  signal: AbortSignal,
  options: HttpExtractOptions,
): Promise<Response> {
  if (!options.headers) return fetch(url, { signal, headers: DEFAULT_REQUEST_HEADERS });

  let currentUrl = url;
  for (let redirectCount = 0; redirectCount <= MAX_SCOPED_HEADER_REDIRECTS; redirectCount++) {
    const parsed = new URL(currentUrl);
    const response = await fetch(currentUrl, {
      signal,
      redirect: "manual",
      headers: headersForUrl(parsed, options),
    });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers.get("location");
    if (!location) return response;
    currentUrl = new URL(location, currentUrl).toString();
  }

  throw new Error(`Too many redirects fetching ${url}`);
}

export async function extractViaHttp(
  url: string,
  signal?: AbortSignal,
  options: HttpExtractOptions = {},
): Promise<ExtractedContent> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort);
  try {
    const response = await fetchWithScopedHeaders(url, controller.signal, options);
    if (!response.ok) {
      const message = `HTTP ${response.status}: ${response.statusText}`;
      return { url, title: "", content: "", error: message, errorDetails: fetchFailedError(url, message) };
    }
    const contentType = response.headers.get("content-type") || DEFAULT_HEADER_VALUE;
    if (contentType.includes("application/pdf")) {
      const error = pdfUnsupportedError(url);
      return { url, title: "", content: "", error: error.cause ?? error.message, errorDetails: error };
    }
    const contentLength = Number.parseInt(response.headers.get("content-length") || DEFAULT_CONTENT_LENGTH_HEADER, 10);
    if (contentLength > 5 * 1024 * 1024) {
      const message = `Response too large (${Math.round(contentLength / 1024 / 1024)}MB)`;
      return { url, title: "", content: "", error: message, errorDetails: contentTooLargeError(url, message) };
    }
    if (
      contentType.includes("image/") ||
      contentType.includes("audio/") ||
      contentType.includes("video/") ||
      contentType.includes("application/zip")
    ) {
      const message = `Unsupported content type: ${contentType.split(";")[0]}`;
      return { url, title: "", content: "", error: message, errorDetails: unsupportedContentTypeError(url, message) };
    }
    const text = await response.text();
    const isHtml =
      contentType.includes("text/html") || contentType.includes("application/xhtml+xml") || /^\s*</.test(text);
    if (!isHtml) return { url, title: extractTextTitle(text, url), content: text, error: null, provider: "http" };
    const { document } = parseHTML(text);
    const article = new Readability(document as unknown as Document).parse();
    if (!article) {
      const message = "Could not extract readable content from HTML structure";
      return { url, title: "", content: "", error: message, errorDetails: fetchFailedError(url, message) };
    }
    const markdown = turndown.turndown(article.content ?? DEFAULT_ARTICLE_CONTENT);
    if (markdown.length < MIN_USEFUL_CONTENT) {
      const message = "Extracted content appears incomplete";
      return {
        url,
        title: article.title || DEFAULT_ARTICLE_TITLE,
        content: markdown,
        error: message,
        errorDetails: fetchFailedError(url, message),
      };
    }
    return { url, title: article.title || DEFAULT_ARTICLE_TITLE, content: markdown, error: null, provider: "http" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      url,
      title: "",
      content: "",
      error: isAbortError(err) ? "Aborted" : message,
      errorDetails: isAbortError(err) ? abortedError(url) : fetchFailedError(url, message),
    };
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", onAbort);
  }
}

function extractTextTitle(text: string, url: string): string {
  return extractHeadingTitle(text) ?? (new URL(url).pathname.split("/").pop() || url);
}
