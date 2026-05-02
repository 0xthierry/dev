import type { WebAccessError } from "./shared/errors";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  source?: string;
}

export type SearchProviderName = "exa" | "brave" | "tavily" | "codex";
export type ContentProviderName =
  | "exa"
  | "brave"
  | "tavily"
  | "http"
  | "jina"
  | "gemini-web"
  | "codex"
  | "github"
  | "youtube";

export interface SearchResponse {
  answer: string;
  results: SearchResult[];
  provider: SearchProviderName;
  inlineContent?: ExtractedContent[];
}

export interface SearchOptions {
  numResults?: number;
  recencyFilter?: "day" | "week" | "month" | "year";
  domainFilter?: string[];
  includeContent?: boolean;
  signal?: AbortSignal;
}

export interface VideoFrame {
  data: string;
  mimeType: string;
  timestamp: string;
}

interface ExtractedContentBase {
  url: string;
  title: string;
  content: string;
  provider?: ContentProviderName;
  thumbnail?: { data: string; mimeType: string };
  frames?: VideoFrame[];
  duration?: number;
}

export interface ExtractedContentSuccess extends ExtractedContentBase {
  error: null;
  errorDetails?: never;
}

export interface ExtractedContentFailure extends ExtractedContentBase {
  error: string;
  errorDetails: WebAccessError;
}

export type ExtractedContent = ExtractedContentSuccess | ExtractedContentFailure;

export interface FetchOptions {
  forceClone?: boolean;
  prompt?: string;
  timestamp?: string;
  frames?: number;
  model?: string;
  signal?: AbortSignal;
}

interface QueryResultBase {
  query: string;
  answer: string;
  results: SearchResult[];
  provider?: string;
}

export interface QueryResultSuccess extends QueryResultBase {
  error: null;
  errorDetails?: never;
}

export interface QueryResultFailure extends QueryResultBase {
  error: string;
  errorDetails: WebAccessError;
}

export type QueryResultData = QueryResultSuccess | QueryResultFailure;

export interface StoredSearchData {
  id: string;
  type: "search" | "fetch";
  timestamp: number;
  queries?: QueryResultData[];
  urls?: ExtractedContent[];
}
