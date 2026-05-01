import { loadConfig, normalizedBoolean, normalizedString, type WebSearchConfig } from "../../config";
import { extractHeadingTitle } from "../../shared/text";
import type { ExtractedContent } from "../../types";
import { isGeminiWebAvailable, queryWithCookies } from "../gemini-web";
import { fetchYouTubeThumbnail } from "./thumbnail";
import { isYouTubeUrl } from "./url";

const DEFAULT_YOUTUBE_MODEL = "gemini-3-flash-preview";
const DEFAULT_YOUTUBE_TITLE = "YouTube Video";
const DEFAULT_YOUTUBE_PROMPT = `Extract the complete content of this YouTube video. Include:
1. Video title, channel name, and duration
2. A brief summary (2-3 sentences)
3. Full transcript with timestamps
4. Descriptions of any code, terminal commands, diagrams, slides, or UI shown on screen

Format as markdown.`;

interface YouTubeConfig {
  enabled: boolean;
  preferredModel: string;
}

export function normalizeYouTubeConfig(raw: WebSearchConfig["youtube"] = {}): YouTubeConfig {
  return {
    enabled: normalizedBoolean(raw.enabled, true),
    preferredModel: normalizedString(raw.preferredModel) ?? DEFAULT_YOUTUBE_MODEL,
  };
}

function youtubeConfig(): YouTubeConfig {
  return normalizeYouTubeConfig(loadConfig().youtube);
}

export function isYouTubeEnabled(): boolean {
  return youtubeConfig().enabled;
}

export async function extractYouTube(
  url: string,
  signal?: AbortSignal,
  prompt?: string,
  model?: string,
): Promise<ExtractedContent | null> {
  const config = youtubeConfig();
  if (!config.enabled) return null;
  const { videoId } = isYouTubeUrl(url);
  const canonicalUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : url;
  const cookies = await isGeminiWebAvailable();
  if (!cookies) return null;
  const text = await queryWithCookies(prompt ?? DEFAULT_YOUTUBE_PROMPT, cookies, {
    youtubeUrl: canonicalUrl,
    model: model ?? config.preferredModel,
    signal,
    timeoutMs: 120_000,
  });
  const result: ExtractedContent = {
    url,
    title: extractHeadingTitle(text) ?? DEFAULT_YOUTUBE_TITLE,
    content: text,
    error: null,
    provider: "youtube",
  };
  if (videoId) {
    const thumbnail = await fetchYouTubeThumbnail(videoId, signal);
    if (thumbnail) result.thumbnail = thumbnail;
  }
  return result;
}
