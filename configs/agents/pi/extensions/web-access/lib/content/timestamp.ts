export const DEFAULT_RANGE_FRAMES = 6;
export const MIN_FRAME_INTERVAL = 5;

export type TimestampSpec = { type: "single"; seconds: number } | { type: "range"; start: number; end: number };

function parseTimestamp(timestamp: string): number | null {
  const numeric = Number(timestamp);
  if (!Number.isNaN(numeric) && numeric >= 0) return Math.floor(numeric);
  const parts = timestamp.split(":").map(Number);
  if (parts.some((part) => Number.isNaN(part) || part < 0)) return null;
  if (parts.length === 3) return Math.floor(parts[0] * 3600 + parts[1] * 60 + parts[2]);
  if (parts.length === 2) return Math.floor(parts[0] * 60 + parts[1]);
  return null;
}

export function parseTimestampSpec(timestamp: string): TimestampSpec | null {
  const dash = timestamp.indexOf("-", 1);
  if (dash > 0) {
    const start = parseTimestamp(timestamp.slice(0, dash));
    const end = parseTimestamp(timestamp.slice(dash + 1));
    if (start !== null && end !== null && end > start) return { type: "range", start, end };
  }
  const seconds = parseTimestamp(timestamp);
  return seconds !== null ? { type: "single", seconds } : null;
}

export function computeRangeTimestamps(start: number, end: number, maxFrames = DEFAULT_RANGE_FRAMES): number[] {
  if (maxFrames <= 1) return [start];
  const duration = end - start;
  const idealInterval = duration / (maxFrames - 1);
  if (idealInterval < MIN_FRAME_INTERVAL) {
    const timestamps: number[] = [];
    for (let time = start; time <= end && timestamps.length < maxFrames; time += MIN_FRAME_INTERVAL)
      timestamps.push(time);
    return timestamps;
  }
  return Array.from({ length: maxFrames }, (_, index) => Math.round(start + index * idealInterval));
}
