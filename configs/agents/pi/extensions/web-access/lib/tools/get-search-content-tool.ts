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

function nextChunkHint(
  params: { responseId: string; url?: string; urlIndex?: number; limit?: number },
  range: ContentRange,
): string {
  if (!range.hasMore) return "";
  const selector = params.url ? `url: ${JSON.stringify(params.url)}` : `urlIndex: ${params.urlIndex ?? 0}`;
  const limit = params.limit ? `, limit: ${range.limit}` : "";
  return `\n\nUse get_search_content({ responseId: "${params.responseId}", ${selector}, offset: ${range.endOffset}${limit} }) for the next chunk.`;
}

export function registerGetSearchContentTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "get_search_content",
    label: "Get Search Content",
    description:
      "Retrieve stored search results or fetched content from a previous web_search or fetch_content call. Use when initial output was truncated, when a batch fetch returned only a summary, when full stored content is needed, or when paging through long content with offset/limit.",
    promptSnippet:
      "Use when web_search or fetch_content returned a responseId/searchId/fetchId and you need stored results, full content, a long-content chunk, or a specific URL/query from the batch.",
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
        return {
          content: [{ type: "text", text: formatSearchSummary(query.results, query.answer) }],
          details: { query: query.query, resultCount: query.results.length },
        };
      }
      if (data.type === "fetch" && data.urls) {
        const result = params.url ? data.urls.find((item) => item.url === params.url) : data.urls[params.urlIndex ?? 0];
        if (!result) failTool(storedUrlNotFoundError(params.responseId, params.url, params.urlIndex, data.urls.length));
        if (result.error) return errorResult(result.errorDetails, { url: result.url });
        const range = sliceContentRange(result.content, params.offset, params.limit);
        const text = `# ${result.title}\n\n${range.text}${nextChunkHint(params, range)}`;
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
