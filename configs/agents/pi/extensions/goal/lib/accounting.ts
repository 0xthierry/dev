export type UsageSnapshot =
  | {
      totalTokens?: number;
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
    }
  | null
  | undefined;

export function tokenDeltaFromUsage(usage: UsageSnapshot): number {
  if (!usage) return 0;
  if (typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens))
    return Math.max(0, Math.trunc(usage.totalTokens));
  return channel(usage.input) + channel(usage.output) + channel(usage.cacheRead) + channel(usage.cacheWrite);
}

function channel(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}
