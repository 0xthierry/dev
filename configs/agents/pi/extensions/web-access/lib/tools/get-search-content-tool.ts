import type { AgentToolResult, ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  invalidStoredDataError,
  queryIndexOutOfRangeError,
  storedResultNotFoundError,
  storedUrlNotFoundError,
} from "../shared/errors";
import { getResult } from "../storage/result-store";
import { GET_SEARCH_CONTENT_PARAMETERS, MAX_INLINE_CONTENT } from "./definitions";
import { errorResult, failTool, formatToolError } from "./errors";
import { formatSearchSummary } from "./render";

export interface ContentRange {
  offset: number;
  limit: number;
  endOffset: number;
  text: string;
  hasMore: boolean;
}

export function sliceContentRange(content: string, offset = 0, limit = MAX_INLINE_CONTENT): ContentRange {
  const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
  const safeLimit =
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), MAX_INLINE_CONTENT) : MAX_INLINE_CONTENT;
  const text = content.slice(safeOffset, safeOffset + safeLimit);
  const endOffset = safeOffset + text.length;
  return {
    offset: safeOffset,
    limit: safeLimit,
    endOffset,
    text,
    hasMore: endOffset < content.length,
  };
}

type StoredContentSelector = { queryIndex: number } | { url: string } | { urlIndex: number };

function nextChunkHint(
  responseId: string,
  selector: StoredContentSelector,
  requestedLimit: number | undefined,
  range: ContentRange,
): string {
  if (!range.hasMore) return "";
  const selectedContent =
    "queryIndex" in selector
      ? `queryIndex: ${selector.queryIndex}`
      : "url" in selector
        ? `url: ${JSON.stringify(selector.url)}`
        : `urlIndex: ${selector.urlIndex}`;
  const limit = requestedLimit ? `, limit: ${range.limit}` : "";
  return `\n\nUse get_search_content({ responseId: "${responseId}", ${selectedContent}, offset: ${range.endOffset}${limit} }) for the next chunk.`;
}

export function registerGetSearchContentTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "get_search_content",
    label: "Get Search Content",
    description:
      "Retrieve stored search results or fetched content from a previous web_search or fetch_content call, with pagination for long search summaries and fetched content. Use when initial output was truncated, when a batch fetch returned only a summary, when full stored content is needed, or when paging with offset/limit.",
    promptSnippet:
      "Use when web_search or fetch_content returned a responseId/searchId/fetchId and you need a stored search-summary or fetched-content chunk, or a specific URL/query from a batch. Continue truncated results with the returned nextOffset.",
    parameters: GET_SEARCH_CONTENT_PARAMETERS,
    async execute(_toolCallId, params): Promise<AgentToolResult<Record<string, unknown>>> {
      const data = getResult(params.responseId);
      if (!data) failTool(storedResultNotFoundError(params.responseId));
      if (data.type === "search" && data.queries) {
        const index = params.queryIndex ?? 0;
        const query = data.queries[index];
        if (!query) failTool(queryIndexOutOfRangeError(params.responseId, index, data.queries.length));
        if (query.error) {
          const error = query.errorDetails;
          return {
            content: [{ type: "text", text: formatToolError(error) }],
            details: { query: query.query, resultCount: query.results.length, error },
          };
        }
        const summary = formatSearchSummary(query.results, query.answer);
        const range = sliceContentRange(summary, params.offset, params.limit);
        const text = `${range.text}${nextChunkHint(params.responseId, { queryIndex: index }, params.limit, range)}`;
        return {
          content: [{ type: "text", text }],
          details: {
            query: query.query,
            resultCount: query.results.length,
            contentLength: summary.length,
            offset: range.offset,
            limit: range.limit,
            returnedChars: range.text.length,
            nextOffset: range.hasMore ? range.endOffset : null,
            truncated: range.hasMore,
          },
        };
      }
      if (data.type === "fetch" && data.urls) {
        const result = params.url ? data.urls.find((item) => item.url === params.url) : data.urls[params.urlIndex ?? 0];
        if (!result) failTool(storedUrlNotFoundError(params.responseId, params.url, params.urlIndex, data.urls.length));
        if (result.error) return errorResult(result.errorDetails, { url: result.url });
        const range = sliceContentRange(result.content, params.offset, params.limit);
        const selector: StoredContentSelector = params.url ? { url: params.url } : { urlIndex: params.urlIndex ?? 0 };
        const text = `# ${result.title}\n\n${range.text}${nextChunkHint(
          params.responseId,
          selector,
          params.limit,
          range,
        )}`;
        return {
          content: [{ type: "text", text }],
          details: {
            url: result.url,
            title: result.title,
            contentLength: result.content.length,
            offset: range.offset,
            limit: range.limit,
            returnedChars: range.text.length,
            nextOffset: range.hasMore ? range.endOffset : null,
            truncated: range.hasMore,
          },
        };
      }
      failTool(invalidStoredDataError(params.responseId, data.type));
    },
  });
}
