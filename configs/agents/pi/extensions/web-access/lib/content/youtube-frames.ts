import { extractYouTubeFrames, getYouTubeStreamInfo } from "../providers/youtube/frames";
import { fetchFailedError } from "../shared/errors";
import { formatSeconds } from "../shared/text";
import type { ExtractedContent, FetchOptions, VideoFrame } from "../types";
import { computeRangeTimestamps, DEFAULT_RANGE_FRAMES, MIN_FRAME_INTERVAL, parseTimestampSpec } from "./timestamp";

const DEFAULT_FRAME_EXTRACTION_ERROR = "Frame extraction failed";

type FramePlan = {
  label: string;
  title: string;
  timestamps: number[];
};

type FramePlanResult = { ok: true; plan: FramePlan } | { ok: false; title: string; message: string };

function frameFailure(url: string, title: string, message: string): ExtractedContent {
  return { url, title, content: message, error: message, errorDetails: fetchFailedError(url, message) };
}

function buildFrameResult(
  url: string,
  label: string,
  requestedCount: number,
  frames: VideoFrame[],
  error: string | null,
  duration?: number,
): ExtractedContent {
  if (frames.length === 0) {
    const message = error ?? DEFAULT_FRAME_EXTRACTION_ERROR;
    return {
      url,
      title: `Frames ${label} (0/${requestedCount})`,
      content: message,
      error: message,
      errorDetails: fetchFailedError(url, message),
    };
  }
  return {
    url,
    title: `Frames ${label} (${frames.length}/${requestedCount})`,
    content: `${frames.length} frames extracted from ${label}`,
    error: null,
    frames,
    duration,
    provider: "youtube",
  };
}

function durationExceeded(title: string, requestedEnd: number, duration: number | null): FramePlanResult | null {
  if (duration === null || requestedEnd <= duration) return null;
  return {
    ok: false,
    title,
    message: `Timestamp ${formatSeconds(requestedEnd)} exceeds video duration (${formatSeconds(Math.floor(duration))})`,
  };
}

export function planYouTubeFrameRequest(options: FetchOptions, duration: number | null): FramePlanResult {
  if (options.frames && !options.timestamp) {
    if (duration === null) {
      return { ok: false, title: "Frames", message: "Cannot determine video duration. Use a timestamp range instead." };
    }
    const end = Math.floor(duration);
    return {
      ok: true,
      plan: {
        label: `${formatSeconds(0)}-${formatSeconds(end)}`,
        title: "Frames",
        timestamps: computeRangeTimestamps(0, end, options.frames),
      },
    };
  }

  if (!options.timestamp) return { ok: false, title: "Frames", message: "Missing timestamp" };

  const spec = parseTimestampSpec(options.timestamp);
  if (!spec) {
    return {
      ok: false,
      title: "",
      message: `Invalid timestamp format: "${options.timestamp}". Use "H:MM:SS", "MM:SS", "85", or "start-end".`,
    };
  }

  if (spec.type === "range") {
    const exceeded = durationExceeded(`Frames ${options.timestamp}`, spec.end, duration);
    if (exceeded) return exceeded;
    return {
      ok: true,
      plan: {
        label: `${formatSeconds(spec.start)}-${formatSeconds(spec.end)}`,
        title: `Frames ${options.timestamp}`,
        timestamps: computeRangeTimestamps(spec.start, spec.end, options.frames || DEFAULT_RANGE_FRAMES),
      },
    };
  }

  const end = options.frames ? spec.seconds + (options.frames - 1) * MIN_FRAME_INTERVAL : spec.seconds;
  const exceeded = durationExceeded(`Frame at ${options.timestamp}`, end, duration);
  if (exceeded) return exceeded;
  return {
    ok: true,
    plan: {
      label: options.frames ? `${formatSeconds(spec.seconds)}-${formatSeconds(end)}` : formatSeconds(spec.seconds),
      title: `Frame at ${options.timestamp}`,
      timestamps: options.frames ? computeRangeTimestamps(spec.seconds, end, options.frames) : [spec.seconds],
    },
  };
}

export async function extractYouTubeFrameRequest(
  url: string,
  videoId: string,
  options: FetchOptions,
): Promise<ExtractedContent> {
  const streamInfo = await getYouTubeStreamInfo(videoId, options.signal);
  if ("error" in streamInfo) return frameFailure(url, "Frames", streamInfo.error);

  const planned = planYouTubeFrameRequest(options, streamInfo.duration);
  if (!planned.ok) return frameFailure(url, planned.title, planned.message);

  const result = await extractYouTubeFrames(videoId, planned.plan.timestamps, streamInfo, options.signal);
  return buildFrameResult(
    url,
    planned.plan.label,
    planned.plan.timestamps.length,
    result.frames,
    result.error,
    result.duration ?? undefined,
  );
}
