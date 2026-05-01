import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { fetchFailedError, noFetchUrlError } from "../shared/errors";
import { trimText } from "../shared/text";
import type { ExtractedContentFailure } from "../types";
import { FETCH_CONTENT_PARAMETERS, MAX_INLINE_CONTENT } from "./definitions";
import { errorResult } from "./errors";
import { stripImages } from "./render";
import { storeAndPublish } from "./result-publisher";
import type { WebAccessRuntime } from "./runtime";

const DEFAULT_MISSING_URL = "";

function missingResult(url: string): ExtractedContentFailure {
  const message = "Content extraction failed.";
  return { url, title: "", content: "", error: message, errorDetails: fetchFailedError(url, message) };
}

export function registerFetchContentTool(pi: ExtensionAPI, runtime: WebAccessRuntime): void {
  pi.registerTool({
    name: "fetch_content",
    label: "Fetch Content",
    description:
      "Fetch one or more URLs and extract readable markdown or structured content. Use to read articles and documentation, inspect GitHub repositories or files, analyze YouTube videos, retrieve video thumbnails, or extract requested video frames. PDFs and local video files are unsupported.",
    promptSnippet:
      "Use when the user provides URLs or asks to inspect a web page, repository, or YouTube video. Include the user's exact question in prompt when they want specific information from video or page content.",
    parameters: FETCH_CONTENT_PARAMETERS,
    async execute(_toolCallId, params, signal, onUpdate) {
      const urls = params.urls ?? (params.url ? [params.url] : []);
      if (urls.length === 0)
        return errorResult(noFetchUrlError({ hasUrl: Boolean(params.url), hasUrls: Boolean(params.urls) }));
      onUpdate?.({
        content: [{ type: "text", text: `Fetching ${urls.length} URL(s)...` }],
        details: { phase: "fetch", progress: 0 },
      });
      const results = await runtime.fetchAllContent(urls, signal, {
        forceClone: params.forceClone,
        prompt: params.prompt,
        timestamp: params.timestamp,
        frames: params.frames,
        model: params.model,
      });
      const responseId = runtime.generateId();
      storeAndPublish(pi, { id: responseId, type: "fetch", timestamp: runtime.now(), urls: stripImages(results) });

      if (urls.length === 1) {
        const result = results[0] ?? missingResult(urls[0] ?? DEFAULT_MISSING_URL);
        if (result.error) {
          return errorResult(result.errorDetails, {
            responseId,
            urls,
            urlCount: 1,
            successful: 0,
          });
        }
        const trimmed = trimText(result.content, MAX_INLINE_CONTENT);
        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
        if (result.frames?.length) {
          for (const frame of result.frames) {
            content.push({ type: "image", data: frame.data, mimeType: frame.mimeType });
            content.push({ type: "text", text: `Frame at ${frame.timestamp}` });
          }
        } else if (result.thumbnail) {
          content.push({ type: "image", data: result.thumbnail.data, mimeType: result.thumbnail.mimeType });
        }
        content.push({
          type: "text",
          text: trimmed.truncated
            ? `${trimmed.text}\n\nUse get_search_content({ responseId: "${responseId}", urlIndex: 0 }) for stored content.`
            : trimmed.text,
        });
        return {
          content,
          details: {
            responseId,
            urls,
            urlCount: 1,
            successful: 1,
            title: result.title,
            totalChars: result.content.length,
            truncated: trimmed.truncated,
            provider: result.provider,
            hasImage: Boolean(result.thumbnail || result.frames?.length),
            imageCount: (result.frames?.length ?? 0) + (result.thumbnail ? 1 : 0),
          } as Record<string, unknown>,
        };
      }

      const output = [
        "## Fetched URLs",
        "",
        ...results.map((result, index) =>
          result.error
            ? `- ${index}: ${result.url}: Error - ${result.error}`
            : `- ${index}: ${result.title || result.url} (${result.content.length} chars)`,
        ),
        "",
        `Use get_search_content({ responseId: "${responseId}", urlIndex: 0 }) to retrieve stored content.`,
      ].join("\n");
      return {
        content: [{ type: "text", text: output }],
        details: {
          responseId,
          urls,
          urlCount: urls.length,
          successful: results.filter((result) => !result.error).length,
          errors: results
            .filter((result): result is ExtractedContentFailure => Boolean(result.error))
            .map((result) => result.errorDetails),
        },
      };
    },
  });
}
