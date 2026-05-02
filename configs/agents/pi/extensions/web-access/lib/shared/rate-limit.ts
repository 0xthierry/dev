export interface RateLimitRetryOptions {
  defaultDelayMs: number;
  maxDelayMs: number;
}

const MILLISECONDS_PER_SECOND = 1_000;
const MILLISECONDS_PER_MINUTE = 60_000;

export function parseRetryAfterMs(headers: Headers, now = Date.now()): number | undefined {
  const value = headers.get("retry-after")?.trim();
  if (!value) return undefined;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * MILLISECONDS_PER_SECOND);

  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - now);
}

export function parseRateLimitDelayFromText(text: string): number | undefined {
  const normalized = text.replace(/\s+/g, " ").trim();
  const match = normalized.match(
    /(?:retry(?:\s|-)?after|try again in|wait)\D{0,20}(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec|secs|seconds?|m|min|mins|minutes?)?/i,
  );
  if (!match?.[1]) return undefined;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return undefined;

  const unit = match[2]?.toLowerCase() ?? "s";
  if (unit === "ms" || unit.startsWith("millisecond")) return amount;
  if (unit === "m" || unit.startsWith("min")) return amount * MILLISECONDS_PER_MINUTE;
  return amount * MILLISECONDS_PER_SECOND;
}

export function isRateLimitText(text: string): boolean {
  return /rate limit|too many requests|\b429\b/i.test(text);
}

export function rateLimitRetryDelayMs(
  options: RateLimitRetryOptions & { headers?: Headers; text?: string; now?: number },
): number | undefined {
  const delayMs =
    (options.headers ? parseRetryAfterMs(options.headers, options.now) : undefined) ??
    (options.text ? parseRateLimitDelayFromText(options.text) : undefined) ??
    options.defaultDelayMs;
  return delayMs <= options.maxDelayMs ? delayMs : undefined;
}

export function waitForRateLimit(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new Error("Aborted"));

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      reject(new Error("Aborted"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
