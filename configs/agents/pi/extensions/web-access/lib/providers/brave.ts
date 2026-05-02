import { getConfiguredEnvValue, loadConfig, normalizedString } from "../config";
import { rateLimitRetryDelayMs, waitForRateLimit } from "../shared/rate-limit";
import type { ExtractedContent, SearchOptions, SearchResponse, SearchResult } from "../types";

const BRAVE_LLM_CONTEXT_URL = "https://api.search.brave.com/res/v1/llm/context";
const DEFAULT_RESULT_TITLE = "Brave source";
const DEFAULT_HOSTNAME = "";
const SEARCH_SNIPPET_MAX_CHARS = 1_500;
const REQUEST_TIMEOUT_MS = 30_000;
const BRAVE_MAX_ATTEMPTS = 2;
const BRAVE_DEFAULT_RATE_LIMIT_DELAY_MS = 1_000;
const BRAVE_MAX_RATE_LIMIT_DELAY_MS = 10_000;

interface BraveContextItem {
  url?: unknown;
  title?: unknown;
  name?: unknown;
  snippets?: unknown;
}

interface BraveSourceMetadata {
  title?: unknown;
  hostname?: unknown;
  age?: unknown;
}

interface BraveLlmContextResponse {
  grounding?: {
    generic?: unknown;
    poi?: unknown;
    map?: unknown;
  };
  sources?: Record<string, BraveSourceMetadata>;
}

export function getBraveApiKey(): string | undefined {
  const config = loadConfig();
  return getConfiguredEnvValue(config.braveApiKeyEnv, "BRAVE_API_KEY") ?? normalizedString(config.braveApiKey);
}

export function isBraveConfigured(): boolean {
  return Boolean(getBraveApiKey());
}

export function mapBraveFreshness(filter: SearchOptions["recencyFilter"]): string | undefined {
  const values: Record<NonNullable<SearchOptions["recencyFilter"]>, string> = {
    day: "pd",
    week: "pw",
    month: "pm",
    year: "py",
  };
  return filter ? values[filter] : undefined;
}

function clampResultCount(value: number | undefined): number {
  return Math.min(Math.max(Math.floor(value ?? 5), 1), 20);
}

function cleanDomain(domain: string): string | null {
  const trimmed = domain.trim().replace(/^-+/, "");
  return trimmed.length > 0 ? trimmed : null;
}

export function buildBraveQuery(query: string, domainFilter: string[] | undefined): string {
  if (!domainFilter?.length) return query;

  const includeDomains = domainFilter
    .filter((domain) => !domain.startsWith("-"))
    .map(cleanDomain)
    .filter((domain): domain is string => Boolean(domain));
  const excludeDomains = domainFilter
    .filter((domain) => domain.startsWith("-"))
    .map(cleanDomain)
    .filter((domain): domain is string => Boolean(domain));

  const includeExpression =
    includeDomains.length === 0
      ? ""
      : includeDomains.length === 1
        ? `site:${includeDomains[0]}`
        : `(${includeDomains.map((domain) => `site:${domain}`).join(" OR ")})`;
  const excludeExpression = excludeDomains.map((domain) => `-site:${domain}`).join(" ");

  return [query.trim(), includeExpression, excludeExpression].filter(Boolean).join(" ");
}

function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function responseErrorDetail(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const nested = record.error;
  if (nested && typeof nested === "object") {
    const detail = (nested as Record<string, unknown>).detail;
    if (typeof detail === "string") return detail;
  }
  if (typeof record.detail === "string") return record.detail;
  return "";
}

function braveErrorMessage(status: number, raw: string, retryDelayMs?: number): string {
  let detail = raw.slice(0, 300);
  try {
    detail = responseErrorDetail(JSON.parse(raw) as unknown) || detail;
  } catch {}

  if (status === 429) {
    const retryHint = retryDelayMs === undefined ? "" : ` Retry after ${Math.ceil(retryDelayMs / 1000)} second(s).`;
    return `Brave Search API rate limit exceeded (429).${retryHint}${detail ? ` Response: ${detail}` : ""}`;
  }

  return `Brave Search API error ${status}: ${detail}`;
}

function asContextItems(value: unknown): BraveContextItem[] {
  if (Array.isArray(value)) return value.filter((item): item is BraveContextItem => Boolean(item));
  if (value && typeof value === "object") return [value as BraveContextItem];
  return [];
}

function snippetText(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((snippet) => (typeof snippet === "string" ? snippet : JSON.stringify(snippet)))
    .map((snippet) => snippet.trim())
    .filter(Boolean);
}

function sourceHostname(url: string, sources: Record<string, BraveSourceMetadata> | undefined): string {
  const source = sources?.[url];
  if (typeof source?.hostname === "string" && source.hostname.trim()) return source.hostname.trim();
  try {
    return new URL(url).hostname;
  } catch {
    return DEFAULT_HOSTNAME;
  }
}

function sourceTitle(
  item: BraveContextItem,
  url: string,
  sources: Record<string, BraveSourceMetadata> | undefined,
): string {
  if (typeof item.title === "string" && item.title.trim()) return item.title.trim();
  if (typeof item.name === "string" && item.name.trim()) return item.name.trim();
  const source = sources?.[url];
  if (typeof source?.title === "string" && source.title.trim()) return source.title.trim();
  return DEFAULT_RESULT_TITLE;
}

function sourceDate(url: string, sources: Record<string, BraveSourceMetadata> | undefined): string | undefined {
  const age = sources?.[url]?.age;
  if (Array.isArray(age))
    return age.find((item): item is string => typeof item === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item));
  return undefined;
}

function compactSnippet(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > SEARCH_SNIPPET_MAX_CHARS
    ? `${normalized.slice(0, SEARCH_SNIPPET_MAX_CHARS)}…`
    : normalized;
}

function mapContextResponse(data: BraveLlmContextResponse, includeContent: boolean): SearchResponse {
  const items = [
    ...asContextItems(data.grounding?.generic),
    ...asContextItems(data.grounding?.poi),
    ...asContextItems(data.grounding?.map),
  ];
  const seen = new Set<string>();
  const results: SearchResult[] = [];
  const inlineContent: ExtractedContent[] = [];

  for (const item of items) {
    if (typeof item.url !== "string" || !item.url || seen.has(item.url)) continue;
    const snippets = snippetText(item.snippets);
    if (snippets.length === 0) continue;

    seen.add(item.url);
    const content = snippets.join("\n\n---\n\n");
    const title = sourceTitle(item, item.url, data.sources);
    results.push({
      title,
      url: item.url,
      snippet: compactSnippet(content),
      publishedDate: sourceDate(item.url, data.sources),
      source: sourceHostname(item.url, data.sources),
    });
    if (includeContent) {
      inlineContent.push({ url: item.url, title, content, error: null, provider: "brave" });
    }
  }

  return {
    answer: "",
    provider: "brave",
    results,
    ...(includeContent && inlineContent.length > 0 ? { inlineContent } : {}),
  };
}

async function postBraveContext(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<BraveLlmContextResponse> {
  for (let attempt = 1; attempt <= BRAVE_MAX_ATTEMPTS; attempt++) {
    const response = await fetch(BRAVE_LLM_CONTEXT_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "Content-Type": "application/json",
        "X-Subscription-Token": apiKey,
      },
      body: JSON.stringify(body),
      signal: requestSignal(signal),
    });

    if (response.ok) return (await response.json()) as BraveLlmContextResponse;

    const errorText = await response.text();
    const retryDelayMs = rateLimitRetryDelayMs({
      headers: response.headers,
      text: errorText,
      defaultDelayMs: BRAVE_DEFAULT_RATE_LIMIT_DELAY_MS,
      maxDelayMs: BRAVE_MAX_RATE_LIMIT_DELAY_MS,
    });
    if (response.status === 429 && attempt < BRAVE_MAX_ATTEMPTS && retryDelayMs !== undefined) {
      await waitForRateLimit(retryDelayMs, signal);
      continue;
    }

    const reportedRetryDelayMs =
      response.status === 429
        ? rateLimitRetryDelayMs({
            headers: response.headers,
            text: errorText,
            defaultDelayMs: BRAVE_DEFAULT_RATE_LIMIT_DELAY_MS,
            maxDelayMs: Number.POSITIVE_INFINITY,
          })
        : retryDelayMs;
    throw new Error(braveErrorMessage(response.status, errorText, reportedRetryDelayMs));
  }

  throw new Error("Brave Search API request failed after retrying rate-limited responses.");
}

export async function searchWithBrave(query: string, options: SearchOptions = {}): Promise<SearchResponse> {
  const apiKey = getBraveApiKey();
  if (!apiKey) {
    throw new Error(
      "Brave Search API key not configured. Set BRAVE_API_KEY or configure braveApiKeyEnv/braveApiKey in ~/.pi/web-search.json.",
    );
  }

  const numResults = clampResultCount(options.numResults);
  const freshness = mapBraveFreshness(options.recencyFilter);
  const data = await postBraveContext(
    apiKey,
    {
      q: buildBraveQuery(query, options.domainFilter),
      count: numResults,
      maximum_number_of_urls: numResults,
      maximum_number_of_tokens: options.includeContent ? 16_384 : 8_192,
      maximum_number_of_snippets: Math.min(100, numResults * 10),
      maximum_number_of_tokens_per_url: 4_096,
      context_threshold_mode: "balanced",
      ...(freshness ? { freshness } : {}),
    },
    options.signal,
  );

  return mapContextResponse(data, Boolean(options.includeContent));
}
