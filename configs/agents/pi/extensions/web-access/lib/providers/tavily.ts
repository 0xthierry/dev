import { getConfiguredEnvValue, loadConfig, normalizedString } from "../config";
import { rateLimitRetryDelayMs, waitForRateLimit } from "../shared/rate-limit";
import { extractHeadingTitle } from "../shared/text";
import type { ExtractedContent, SearchOptions, SearchResponse } from "../types";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";
const REQUEST_TIMEOUT_MS = 60_000;
const TAVILY_MAX_ATTEMPTS = 2;
const TAVILY_DEFAULT_RATE_LIMIT_DELAY_MS = 1_000;
const TAVILY_MAX_RATE_LIMIT_DELAY_MS = 10_000;
const SEARCH_SNIPPET_MAX_CHARS = 1_500;
const DEFAULT_TITLE = "Tavily source";

interface TavilySearchResponse {
  answer?: unknown;
  results?: Array<{
    title?: unknown;
    url?: unknown;
    content?: unknown;
    raw_content?: unknown;
  }>;
}

interface TavilyExtractResponse {
  results?: Array<{
    url?: unknown;
    raw_content?: unknown;
  }>;
  failed_results?: Array<{
    url?: unknown;
    error?: unknown;
  }>;
}

export function getTavilyApiKey(): string | undefined {
  const config = loadConfig();
  return getConfiguredEnvValue(config.tavilyApiKeyEnv, "TAVILY_API_KEY") ?? normalizedString(config.tavilyApiKey);
}

export function isTavilyConfigured(): boolean {
  return Boolean(getTavilyApiKey());
}

function clampResultCount(value: number | undefined): number {
  return Math.min(Math.max(Math.floor(value ?? 5), 1), 20);
}

export function mapTavilyDomainFilter(domainFilter: string[] | undefined): {
  include_domains?: string[];
  exclude_domains?: string[];
} {
  if (!domainFilter?.length) return {};
  const include_domains = domainFilter
    .filter((domain) => !domain.startsWith("-"))
    .map((domain) => domain.trim())
    .filter(Boolean);
  const exclude_domains = domainFilter
    .filter((domain) => domain.startsWith("-"))
    .map((domain) => domain.slice(1).trim())
    .filter(Boolean);
  return {
    ...(include_domains.length > 0 ? { include_domains } : {}),
    ...(exclude_domains.length > 0 ? { exclude_domains } : {}),
  };
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function responseErrorDetail(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const detail = (value as Record<string, unknown>).detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const error = (detail as Record<string, unknown>).error;
    if (typeof error === "string") return error;
  }
  return "";
}

function tavilyErrorMessage(status: number, raw: string, retryDelayMs?: number): string {
  let detail = raw.slice(0, 300);
  try {
    detail = responseErrorDetail(JSON.parse(raw) as unknown) || detail;
  } catch {}

  if (status === 429) {
    const retryHint = retryDelayMs === undefined ? "" : ` Retry after ${Math.ceil(retryDelayMs / 1000)} second(s).`;
    return `Tavily API rate limit exceeded (429).${retryHint}${detail ? ` Response: ${detail}` : ""}`;
  }
  if (status === 432 || status === 433) {
    return `Tavily API usage limit exceeded (${status}).${detail ? ` Response: ${detail}` : ""}`;
  }
  return `Tavily API error ${status}: ${detail}`;
}

async function postTavilyJson<T>(url: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const apiKey = getTavilyApiKey();
  if (!apiKey) {
    throw new Error(
      "Tavily API key not configured. Set TAVILY_API_KEY or configure tavilyApiKeyEnv/tavilyApiKey in ~/.pi/web-search.json.",
    );
  }

  for (let attempt = 1; attempt <= TAVILY_MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: requestSignal(signal),
    });
    if (response.ok) return (await response.json()) as T;

    const errorText = await response.text();
    const retryDelayMs = rateLimitRetryDelayMs({
      headers: response.headers,
      text: errorText,
      defaultDelayMs: TAVILY_DEFAULT_RATE_LIMIT_DELAY_MS,
      maxDelayMs: TAVILY_MAX_RATE_LIMIT_DELAY_MS,
    });
    if (response.status === 429 && attempt < TAVILY_MAX_ATTEMPTS && retryDelayMs !== undefined) {
      await waitForRateLimit(retryDelayMs, signal);
      continue;
    }

    const reportedRetryDelayMs =
      response.status === 429
        ? rateLimitRetryDelayMs({
            headers: response.headers,
            text: errorText,
            defaultDelayMs: TAVILY_DEFAULT_RATE_LIMIT_DELAY_MS,
            maxDelayMs: Number.POSITIVE_INFINITY,
          })
        : retryDelayMs;
    throw new Error(tavilyErrorMessage(response.status, errorText, reportedRetryDelayMs));
  }

  throw new Error("Tavily API request failed after retrying rate-limited responses.");
}

function compactSnippet(value: unknown): string {
  const text = typeof value === "string" ? value : "";
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > SEARCH_SNIPPET_MAX_CHARS
    ? `${normalized.slice(0, SEARCH_SNIPPET_MAX_CHARS)}…`
    : normalized;
}

function resultTitle(value: unknown, url: string, index: number): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  try {
    return new URL(url).hostname;
  } catch {
    return `${DEFAULT_TITLE} ${index + 1}`;
  }
}

export async function searchWithTavily(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  const data = await postTavilyJson<TavilySearchResponse>(
    TAVILY_SEARCH_URL,
    {
      query,
      search_depth: "basic",
      max_results: clampResultCount(options.numResults),
      include_answer: "basic",
      include_raw_content: options.includeContent ? "markdown" : false,
      ...(options.recencyFilter ? { time_range: options.recencyFilter } : {}),
      ...mapTavilyDomainFilter(options.domainFilter),
    },
    options.signal,
  );

  const inlineContent: ExtractedContent[] = [];
  const results = (data.results ?? [])
    .filter((result): result is NonNullable<TavilySearchResponse["results"]>[number] & { url: string } =>
      Boolean(result?.url && typeof result.url === "string"),
    )
    .map((result, index) => {
      const title = resultTitle(result.title, result.url, index);
      const rawContent = typeof result.raw_content === "string" ? result.raw_content : "";
      if (options.includeContent && rawContent.length > 0) {
        inlineContent.push({ url: result.url, title, content: rawContent, error: null, provider: "tavily" });
      }
      return {
        title,
        url: result.url,
        snippet: compactSnippet(result.content),
      };
    });

  return {
    answer: typeof data.answer === "string" ? data.answer : "",
    provider: "tavily",
    results,
    ...(options.includeContent && inlineContent.length > 0 ? { inlineContent } : {}),
  };
}

export async function fetchWithTavilyExtract(
  url: string,
  prompt: string | undefined,
  signal?: AbortSignal,
): Promise<ExtractedContent | null> {
  const data = await postTavilyJson<TavilyExtractResponse>(
    TAVILY_EXTRACT_URL,
    {
      urls: url,
      extract_depth: "basic",
      format: "markdown",
      timeout: 30,
      ...(prompt ? { query: prompt, chunks_per_source: 5 } : {}),
    },
    signal,
  );

  const result = data.results?.find((item) => item.url === url) ?? data.results?.[0];
  if (typeof result?.raw_content === "string" && result.raw_content.trim().length > 0) {
    const content = result.raw_content.trim();
    return {
      url,
      title: extractHeadingTitle(content) ?? new URL(url).hostname,
      content,
      error: null,
      provider: "tavily",
    };
  }

  const failed = data.failed_results?.find((item) => item.url === url) ?? data.failed_results?.[0];
  if (failed?.error) throw new Error(String(failed.error));
  return null;
}
