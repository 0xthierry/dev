import { execFileBuffer, execFileText, isTimeoutError, readExecError, trimErrorText } from "../../shared/process";
import { formatSeconds } from "../../shared/text";
import type { VideoFrame } from "../../types";

export type StreamInfo = { streamUrl: string; duration: number | null };
type StreamResult = StreamInfo | { error: string };

export function mapYtDlpError(err: unknown): string {
  const { code, stderr, message } = readExecError(err);
  if (code === "ENOENT") return "yt-dlp is not installed. Install yt-dlp to extract YouTube frames.";
  const lower = stderr.toLowerCase();
  if (lower.includes("private")) return "Video is private or unavailable";
  if (lower.includes("sign in")) return "Video is age-restricted and requires authentication";
  if (lower.includes("not available")) return "Video is unavailable in your region or has been removed";
  if (lower.includes("live")) return "Cannot extract frames from a live stream";
  const snippet = trimErrorText(stderr || message);
  return snippet ? `yt-dlp failed: ${snippet}` : "yt-dlp failed";
}

export function mapFfmpegError(err: unknown): string {
  const { code, stderr, message } = readExecError(err);
  if (code === "ENOENT") return "ffmpeg is not installed. Install ffmpeg to extract video frames.";
  if (isTimeoutError(err)) return "ffmpeg timed out extracting video frame";
  const snippet = trimErrorText(stderr || message);
  return snippet ? `ffmpeg failed: ${snippet}` : "ffmpeg failed";
}

export async function getYouTubeStreamInfo(videoId: string, signal?: AbortSignal): Promise<StreamResult> {
  try {
    const { stdout } = await execFileText(
      "yt-dlp",
      ["--print", "duration", "-g", `https://www.youtube.com/watch?v=${videoId}`],
      { timeout: 15_000, signal },
    );
    const output = stdout.trim();
    const lines = output.split(/\r?\n/);
    const rawDuration = lines[0]?.trim();
    const streamUrl = lines[1]?.trim();
    if (!streamUrl) return { error: "yt-dlp failed: missing stream URL" };
    const parsedDuration = rawDuration && rawDuration !== "NA" ? Number.parseFloat(rawDuration) : NaN;
    return { streamUrl, duration: Number.isFinite(parsedDuration) ? parsedDuration : null };
  } catch (err) {
    return { error: mapYtDlpError(err) };
  }
}

async function extractFrameFromStream(
  streamUrl: string,
  seconds: number,
  signal?: AbortSignal,
): Promise<{ data: string; mimeType: string } | { error: string }> {
  try {
    const { stdout } = await execFileBuffer(
      "ffmpeg",
      ["-ss", String(seconds), "-i", streamUrl, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"],
      { maxBuffer: 5 * 1024 * 1024, timeout: 30_000, signal },
    );
    if (stdout.length === 0) return { error: "ffmpeg failed: empty output" };
    return { data: stdout.toString("base64"), mimeType: "image/jpeg" };
  } catch (err) {
    return { error: mapFfmpegError(err) };
  }
}

export async function extractYouTubeFrames(
  videoId: string,
  timestamps: number[],
  streamInfo?: StreamInfo,
  signal?: AbortSignal,
): Promise<{ frames: VideoFrame[]; duration: number | null; error: string | null }> {
  const info = streamInfo ?? (await getYouTubeStreamInfo(videoId, signal));
  if ("error" in info) return { frames: [], duration: null, error: info.error };
  const results = await Promise.all(
    timestamps.map(async (timestamp) => {
      const frame = await extractFrameFromStream(info.streamUrl, timestamp, signal);
      if ("error" in frame) return { error: frame.error };
      return { ...frame, timestamp: formatSeconds(timestamp) };
    }),
  );
  const frames = results.filter((frame): frame is VideoFrame => "data" in frame);
  const error = results.find((frame): frame is { error: string } => "error" in frame)?.error ?? null;
  return { frames, duration: info.duration, error: frames.length === 0 ? error : null };
}
