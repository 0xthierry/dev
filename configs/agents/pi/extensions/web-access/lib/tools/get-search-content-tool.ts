import type { AgentToolResult, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  invalidStoredDataError,
  queryIndexOutOfRangeError,
  storedResultNotFoundError,
  storedUrlNotFoundError,
} from "../shared/errors";
import { trimText } from "../shared/text";
import { getResult } from "../storage/result-store";
import { GET_SEARCH_CONTENT_PARAMETERS, MAX_INLINE_CONTENT } from "./definitions";
import { errorResult, formatToolError } from "./errors";
import { formatSearchSummary } from "./render";

export function registerGetSearchContentTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "get_search_content",
    label: "Get Search Content",
    description:
      "Retrieve stored search results or fetched content from a previous web_search or fetch_content call. Use when initial output was truncated, when a batch fetch returned only a summary, or when full stored content is needed.",
    promptSnippet:
      "Use when web_search or fetch_content returned a responseId/searchId/fetchId and you need stored results, full content, or a specific URL/query from the batch.",
    parameters: GET_SEARCH_CONTENT_PARAMETERS,
    async execute(_toolCallId, params): Promise<AgentToolResult<Record<string, unknown>>> {
      const data = getResult(params.responseId);
      if (!data) return errorResult(storedResultNotFoundError(params.responseId), { responseId: params.responseId });
      if (data.type === "search" && data.queries) {
        const index = params.queryIndex ?? 0;
        const query = data.queries[index];
        if (!query) return errorResult(queryIndexOutOfRangeError(params.responseId, index, data.queries.length));
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
        if (!result)
          return errorResult(storedUrlNotFoundError(params.responseId, params.url, params.urlIndex, data.urls.length));
        if (result.error) return errorResult(result.errorDetails, { url: result.url });
        const trimmed = trimText(`# ${result.title}\n\n${result.content}`, MAX_INLINE_CONTENT);
        return {
          content: [{ type: "text", text: trimmed.text }],
          details: {
            url: result.url,
            title: result.title,
            contentLength: result.content.length,
            truncated: trimmed.truncated,
          },
        };
      }
      return errorResult(invalidStoredDataError(params.responseId, data.type));
    },
  });
}
