import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

export const MAX_INLINE_CONTENT = 30_000;
export const CUSTOM_ENTRY_TYPE = "web-access-results";
export const CONTENT_ANALYSIS_MODELS = [
  "gemini-3-flash-preview",
  "gemini-3-pro",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
] as const;

export const WEB_SEARCH_PARAMETERS = Type.Object({
  query: Type.Optional(Type.String({ description: "Single search query. Use for one focused lookup." })),
  queries: Type.Optional(
    Type.Array(Type.String(), { description: "Multiple varied search queries. Use for broader research." }),
  ),
  numResults: Type.Optional(
    Type.Number({ description: "Results per query (default 5, max 20). Use to widen or narrow source count." }),
  ),
  includeContent: Type.Optional(
    Type.Boolean({
      description:
        "Also store available full page text from search results for later retrieval. Use when likely sources need deeper reading.",
    }),
  ),
  recencyFilter: Type.Optional(
    StringEnum(["day", "week", "month", "year"], {
      description: "Filter by recency. Use for news, releases, prices, or time-sensitive facts.",
    }),
  ),
  domainFilter: Type.Optional(
    Type.Array(Type.String(), {
      description: "Limit to domains; prefix with - to exclude. Use when sources must be trusted or avoided.",
    }),
  ),
});

export const FETCH_CONTENT_PARAMETERS = Type.Object({
  url: Type.Optional(Type.String({ description: "Single URL to fetch. Use when inspecting one page or video." })),
  urls: Type.Optional(
    Type.Array(Type.String(), { description: "Multiple URLs to fetch. Use when comparing or batching sources." }),
  ),
  forceClone: Type.Optional(
    Type.Boolean({
      description:
        "Force repository-level retrieval for GitHub URLs when available. Use when a repo tree is more useful than a page view.",
    }),
  ),
  prompt: Type.Optional(
    Type.String({
      description:
        "Question or extraction instructions for fetched content. Use for narrow page/video questions; omit for plain YouTube summary, description, or transcript requests so default video extraction includes transcript with timestamps.",
    }),
  ),
  timestamp: Type.Optional(
    Type.String({
      description:
        "YouTube frame timestamp or range, e.g. 23:41 or 23:41-25:00. Use when visual evidence at a moment is needed.",
    }),
  ),
  frames: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 12,
      description: "Number of YouTube frames to extract. Use with timestamp or when sampling a video visually.",
    }),
  ),
  model: Type.Optional(
    StringEnum([...CONTENT_ANALYSIS_MODELS], {
      description: "Optional model override for video/content analysis. Use only when a specific model is requested.",
    }),
  ),
});

export const GET_SEARCH_CONTENT_PARAMETERS = Type.Object({
  responseId: Type.String({ description: "responseId/searchId/fetchId from web_search or fetch_content" }),
  queryIndex: Type.Optional(
    Type.Number({ description: "Search query index. Use to retrieve one query from a batch." }),
  ),
  urlIndex: Type.Optional(Type.Number({ description: "Fetched URL index. Use to retrieve one URL from a batch." })),
  url: Type.Optional(Type.String({ description: "Fetched URL. Use when selecting stored content by exact URL." })),
  offset: Type.Optional(
    Type.Integer({
      minimum: 0,
      description: "Character offset into stored fetched content (default 0). Use to page through long content.",
    }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: MAX_INLINE_CONTENT,
      description: "Maximum fetched-content characters to return. Use to request smaller chunks.",
    }),
  ),
});
