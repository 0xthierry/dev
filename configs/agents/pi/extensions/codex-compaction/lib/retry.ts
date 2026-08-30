export const CODEX_HTTP_MAX_RETRIES = 4;
export const CODEX_STREAM_MAX_RETRIES = 2;
export const CODEX_RETRY_BASE_DELAY_MS = 200;
export const CODEX_STREAM_IDLE_TIMEOUT_MS = 300_000;

export function retryDelayMs(retryNumber: number, random: () => number = Math.random): number {
  const exponential = CODEX_RETRY_BASE_DELAY_MS * 2 ** Math.max(0, retryNumber - 1);
  const jitter = 0.9 + clampUnit(random()) * 0.2;
  return Math.floor(exponential * jitter);
}

export function retryAfterMs(headers: Headers, now = Date.now()): number | undefined {
  const milliseconds = parseNonNegativeNumber(headers.get("retry-after-ms"));
  if (milliseconds !== undefined) return milliseconds;

  const value = headers.get("retry-after");
  if (!value) return undefined;

  const seconds = parseNonNegativeNumber(value);
  if (seconds !== undefined) return seconds * 1000;

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, timestamp - now);
}

export async function sleepWithAbort(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError();

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(finish, Math.max(0, milliseconds));

    function finish(): void {
      cleanup();
      resolve();
    }

    function abort(): void {
      cleanup();
      reject(abortError());
    }

    function cleanup(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }

    signal?.addEventListener("abort", abort, { once: true });
  });
}

function parseNonNegativeNumber(value: string | null): number | undefined {
  if (value == null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function abortError(): Error {
  return new DOMException("The operation was aborted", "AbortError");
}
