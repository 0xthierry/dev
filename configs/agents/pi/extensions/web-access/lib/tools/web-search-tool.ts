import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { noSearchQueryError, searchAbortedError, searchFailedError, unknownCause } from "../shared/errors";
import { trimText } from "../shared/text";
import type { ExtractedContent, QueryResultData } from "../types";
import { MAX_INLINE_CONTENT, WEB_SEARCH_PARAMETERS } from "./definitions";
import { errorResult, formatToolError } from "./errors";
import { normalizeQueryList, normalizeRecencyFilter } from "./params";
import { formatSearchSummary, uniqueUrls } from "./render";
import { storeAndPublish } from "./result-publisher";
import type { WebAccessRuntime } from "./runtime";

const DEFAULT_QUERY_PROVIDER_LABEL = "unknown";

export function registerWebSearchTool(pi: ExtensionAPI, runtime: WebAccessRuntime): void {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web for current or specialized information and return citation-friendly results with source URLs. Use for recent events, documentation, facts beyond the model's knowledge cutoff, or when authoritative sources are needed.",
    promptSnippet:
      "Use for current web research. Prefer multiple focused queries for broader research, use domain filters when the user names trusted or unwanted sites, and cite returned source URLs.",
    parameters: WEB_SEARCH_PARAMETERS,
    async execute(_toolCallId, params, signal, onUpdate) {
      const queryList = normalizeQueryList(params.queries ?? params.query);
      if (queryList.length === 0) {
        return errorResult(
          noSearchQueryError({ hasQuery: Boolean(params.query), hasQueries: Boolean(params.queries) }),
        );
      }

      const queryResults: QueryResultData[] = [];
      const inlineContent: ExtractedContent[] = [];
      for (let index = 0; index < queryList.length; index++) {
        const query = queryList[index];
        onUpdate?.({
          content: [{ type: "text", text: `Searching ${index + 1}/${queryList.length}: ${query}` }],
          details: { phase: "search", progress: index / queryList.length, query },
        });
        try {
          const result = await runtime.search(query, {
            numResults: params.numResults,
            includeContent: params.includeContent,
            recencyFilter: normalizeRecencyFilter(params.recencyFilter),
            domainFilter: params.domainFilter,
            signal,
          });
          queryResults.push({
            query,
            answer: result.answer,
            results: result.results,
            error: null,
            provider: result.provider,
          });
          if (result.inlineContent) inlineContent.push(...result.inlineContent);
        } catch (err) {
          const cause = unknownCause(err);
          queryResults.push({
            query,
            answer: "",
            results: [],
            error: cause,
            errorDetails: cause.toLowerCase().includes("abort")
              ? searchAbortedError(cause, { query })
              : searchFailedError(cause, { query }),
          });
        }
      }

      const output = queryResults
        .map((result) => {
          if (result.error) {
            return `## Query: "${result.query}"\n\n${formatToolError(result.errorDetails)}`;
          }
          return `${queryList.length > 1 ? `## Query: "${result.query}" (${result.provider ?? DEFAULT_QUERY_PROVIDER_LABEL})\n\n` : ""}${formatSearchSummary(result.results, result.answer)}`;
        })
        .join("\n\n");

      const searchId = runtime.generateId();
      storeAndPublish(pi, { id: searchId, type: "search", timestamp: runtime.now(), queries: queryResults });

      let fetchId: string | null = null;
      if (inlineContent.length > 0) {
        fetchId = runtime.generateId();
        storeAndPublish(pi, { id: fetchId, type: "fetch", timestamp: runtime.now(), urls: inlineContent });
      }

      const queryErrors = queryResults
        .filter((result): result is QueryResultData & { error: string } => Boolean(result.error))
        .map((result) => result.errorDetails);
      const trimmedOutput = trimText(output.trim(), MAX_INLINE_CONTENT);

      return {
        content: [
          {
            type: "text",
            text: trimmedOutput.truncated
              ? `${trimmedOutput.text}\n\nUse get_search_content({ responseId: "${searchId}" }) for stored search results.`
              : trimmedOutput.text,
          },
        ],
        details: {
          queries: queryList,
          queryCount: queryList.length,
          successfulQueries: queryResults.filter((result) => !result.error).length,
          totalResults: queryResults.reduce((sum, result) => sum + result.results.length, 0),
          searchId,
          fetchId,
          urls: uniqueUrls(queryResults),
          queryErrors,
          truncated: trimmedOutput.truncated,
        },
      };
    },
  });
}
