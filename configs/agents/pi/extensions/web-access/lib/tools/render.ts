import type { ExtractedContent, QueryResultData, SearchResult } from "../types";

export function formatSearchSummary(results: SearchResult[], answer: string): string {
  let output = answer ? `${answer}\n\n---\n\n**Sources:**\n` : "**Sources:**\n";
  output += results
    .map(
      (result, index) =>
        `${index + 1}. ${result.title}\n   ${result.url}${result.snippet ? `\n   ${result.snippet}` : ""}`,
    )
    .join("\n\n");
  return output;
}

export function uniqueUrls(results: QueryResultData[]): string[] {
  const urls = new Set<string>();
  for (const query of results) {
    for (const result of query.results) urls.add(result.url);
  }
  return [...urls];
}

export function stripImages(results: ExtractedContent[]): ExtractedContent[] {
  return results.map(({ thumbnail: _thumbnail, frames: _frames, ...rest }) => rest);
}
