import { isGeminiWebAvailable, queryWithCookies } from "../providers/gemini-web";
import { extractHeadingTitle } from "../shared/text";
import type { ExtractedContent } from "../types";

export function buildGeminiExtractionPrompt(url: string): string {
  return `Extract the complete readable content from this URL as clean markdown. Include the page title, all text content, code blocks, and tables. Do not summarize.\n\nURL: ${url}`;
}

export async function extractWithGeminiWeb(url: string, signal?: AbortSignal): Promise<ExtractedContent | null> {
  const cookies = await isGeminiWebAvailable();
  if (!cookies) return null;
  const prompt = buildGeminiExtractionPrompt(url);
  try {
    const content = await queryWithCookies(prompt, cookies, { signal, timeoutMs: 60_000 });
    if (content.length < 50) return null;
    return {
      url,
      title: extractHeadingTitle(content) ?? new URL(url).hostname,
      content,
      error: null,
      provider: "gemini-web",
    };
  } catch {
    return null;
  }
}
