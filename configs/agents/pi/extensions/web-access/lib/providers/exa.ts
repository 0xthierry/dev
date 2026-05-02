import { getConfiguredEnvValue, loadConfig, normalizedString } from "../config";
import { rateLimitRetryDelayMs, waitForRateLimit } from "../shared/rate-limit";
import type { ExtractedContent, SearchOptions, SearchResponse } from "../types";

const EXA_SEARCH_URL = "https://api.exa.ai/search";
const EXA_CONTENTS_URL = "https://api.exa.ai/contents";
const DEFAULT_EXA_STATUS_TAG = "unknown";
const EXA_MAX_ATTEMPTS = 2;
const EXA_DEFAULT_RATE_LIMIT_DELAY_MS = 1_000;
const EXA_MAX_RATE_LIMIT_DELAY_MS = 10_000;

interface ExaSearchResponse {
  results?: Array<{
    title?: string;
    url?: string;
    publishedDate?: string;
    author?: string;
    text?: string;
    highlights?: unknown;
  }>;
}

interface ExaContentsResponse {
  results?: Array<{
    title?: string;
    url?: string;
    id?: string;
    publishedDate?: string | null;
    author?: string | null;
    text?: string;
    highlights?: unknown;
    summary?: string;
  }>;
  statuses?: Array<{
    id?: string;
    status?: string;
    error?: { tag?: string; httpStatusCode?: number | null };
  }>;
}

export function getExaApiKey(): string | undefined {
  const config = loadConfig();
  return getConfiguredEnvValue(config.exaApiKeyEnv, "EXA_API_KEY") ?? normalizedString(config.exaApiKey);
}

export function isExaConfigured(): boolean {
  return Boolean(getExaApiKey());
}

function recencyToStartDate(filter: string): string {
  const now = Date.now();
  const days: Record<string, number> = { day: 1, week: 7, month: 30, year: 365 };
  return new Date(now - (days[filter] ?? 0) * 86_400_000).toISOString();
}

export function mapDomainFilter(domainFilter: string[] | undefined): {
  includeDomains?: string[];
  excludeDomains?: string[];
} {
  if (!domainFilter?.length) return {};
  const includeDomains = domainFilter
    .filter((domain) => !domain.startsWith("-") && domain.trim().length > 0)
    .map((domain) => domain.trim());
  const excludeDomains = domainFilter
    .filter((domain) => domain.startsWith("-"))
    .map((domain) => domain.slice(1).trim())
    .filter(Boolean);
  return {
    ...(includeDomains.length > 0 ? { includeDomains } : {}),
    ...(excludeDomains.length > 0 ? { excludeDomains } : {}),
  };
}

function normalizeHighlights(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function snippetFromResult(result: NonNullable<ExaSearchResponse["results"]>[number]): string {
  const highlights = normalizeHighlights(result.highlights);
  if (highlights.length > 0) return highlights.join(" ").replace(/\s+/g, " ").trim().slice(0, 1000);
  return typeof result.text === "string" ? result.text.replace(/\s+/g, " ").trim().slice(0, 1000) : "";
}

function defaultSourceTitle(index: number): string {
  return `Source ${index + 1}`;
}

function sourceTitle(result: { title?: string }, index: number): string {
  return result.title ? result.title : defaultSourceTitle(index);
}

function buildAnswer(results: NonNullable<ExaSearchResponse["results"]>): string {
  const parts: string[] = [];
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (!result?.url) continue;
    const snippet = snippetFromResult(result);
    if (!snippet) continue;
    parts.push(`${snippet}\nSource: ${sourceTitle(result, index)} (${result.url})`);
  }
  return parts.join("\n\n");
}

function mapInlineContent(results: NonNullable<ExaSearchResponse["results"]>): ExtractedContent[] {
  return results
    .filter(
      (result): result is NonNullable<ExaSearchResponse["results"]>[number] & { url: string; text: string } =>
        Boolean(result?.url) && typeof result.text === "string" && result.text.length > 0,
    )
    .map((result) => ({
      url: result.url,
      title: result.title || result.url,
      content: result.text,
      error: null,
      provider: "exa" as const,
    }));
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(60_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function exaApiErrorMessage(status: number, errorText: string, retryDelayMs?: number): string {
  const body = errorText.slice(0, 300);
  if (status !== 429) return `Exa API error ${status}: ${body}`;

  const retryHint = retryDelayMs === undefined ? "" : ` Retry after ${Math.ceil(retryDelayMs / 1000)} second(s).`;
  return `Exa API rate limit exceeded (429).${retryHint}${body ? ` Response: ${body}` : ""}`;
}

async function postExaJson<T>(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 1; attempt <= EXA_MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
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
      defaultDelayMs: EXA_DEFAULT_RATE_LIMIT_DELAY_MS,
      maxDelayMs: EXA_MAX_RATE_LIMIT_DELAY_MS,
    });
    if (response.status === 429 && attempt < EXA_MAX_ATTEMPTS && retryDelayMs !== undefined) {
      await waitForRateLimit(retryDelayMs, signal);
      continue;
    }

    const reportedRetryDelayMs =
      response.status === 429
        ? rateLimitRetryDelayMs({
            headers: response.headers,
            text: errorText,
            defaultDelayMs: EXA_DEFAULT_RATE_LIMIT_DELAY_MS,
            maxDelayMs: Number.POSITIVE_INFINITY,
          })
        : retryDelayMs;
    throw new Error(exaApiErrorMessage(response.status, errorText, reportedRetryDelayMs));
  }

  throw new Error("Exa API request failed after retrying rate-limited responses.");
}

export async function searchWithExa(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  const apiKey = getExaApiKey();
  if (!apiKey) {
    throw new Error(
      "Exa API key not configured. Set EXA_API_KEY or configure exaApiKeyEnv/exaApiKey in ~/.pi/web-search.json.",
    );
  }

  const numResults = Math.min(Math.max(Math.floor(options.numResults ?? 5), 1), 20);
  const domainFilters = mapDomainFilter(options.domainFilter);
  const startPublishedDate = options.recencyFilter ? recencyToStartDate(options.recencyFilter) : undefined;

  const data = await postExaJson<ExaSearchResponse>(
    EXA_SEARCH_URL,
    apiKey,
    {
      query,
      type: "auto",
      numResults,
      ...domainFilters,
      ...(startPublishedDate ? { startPublishedDate } : {}),
      contents: {
        highlights: true,
        ...(options.includeContent ? { text: { maxCharacters: 30_000 } } : {}),
      },
    },
    options.signal,
  );
  const results = data.results ?? [];
  const mapped: SearchResponse = {
    answer: buildAnswer(results),
    provider: "exa",
    results: results
      .filter((result): result is NonNullable<ExaSearchResponse["results"]>[number] & { url: string } =>
        Boolean(result?.url),
      )
      .map((result, index) => ({
        title: sourceTitle(result, index),
        url: result.url,
        snippet: snippetFromResult(result),
        publishedDate: result.publishedDate,
        source: result.author,
      })),
  };

  if (options.includeContent) {
    const inlineContent = mapInlineContent(results);
    if (inlineContent.length > 0) mapped.inlineContent = inlineContent;
  }

  return mapped;
}

export async function fetchWithExaContents(url: string, signal?: AbortSignal): Promise<ExtractedContent | null> {
  const apiKey = getExaApiKey();
  if (!apiKey) return null;

  const data = await postExaJson<ExaContentsResponse>(
    EXA_CONTENTS_URL,
    apiKey,
    {
      urls: [url],
      text: { maxCharacters: 50_000 },
      maxAgeHours: 24,
      livecrawlTimeout: 15_000,
    },
    signal,
  );
  const status = data.statuses?.find((item) => item.id === url || item.id === data.results?.[0]?.id);
  if (status?.status === "error") {
    const tag = status.error?.tag ?? DEFAULT_EXA_STATUS_TAG;
    const code = status.error?.httpStatusCode ? ` (${status.error.httpStatusCode})` : "";
    throw new Error(`Exa could not fetch URL: ${tag}${code}`);
  }

  const result = data.results?.find((item) => item.url === url) ?? data.results?.[0];
  if (!result?.text) return null;
  return {
    url,
    title: result.title || result.url || url,
    content: result.text,
    error: null,
    provider: "exa",
  };
}
