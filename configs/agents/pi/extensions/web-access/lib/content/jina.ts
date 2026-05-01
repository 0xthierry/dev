import { extractHeadingTitle } from "../shared/text";
import type { ExtractedContent } from "../types";

const JINA_READER_BASE = "https://r.jina.ai/";

export async function extractWithJinaReader(url: string, signal?: AbortSignal): Promise<ExtractedContent | null> {
  try {
    const response = await fetch(JINA_READER_BASE + url, {
      headers: { Accept: "text/markdown", "X-No-Cache": "true" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;
    const content = await response.text();
    const marker = content.indexOf("Markdown Content:");
    const markdown = marker >= 0 ? content.slice(marker + "Markdown Content:".length).trim() : content.trim();
    if (markdown.length < 100 || markdown.startsWith("Loading...") || markdown.startsWith("Please enable JavaScript"))
      return null;
    return {
      url,
      title: extractHeadingTitle(markdown) ?? new URL(url).hostname,
      content: markdown,
      error: null,
      provider: "jina",
    };
  } catch {
    return null;
  }
}
