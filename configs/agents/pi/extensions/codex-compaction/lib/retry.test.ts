import { describe, expect, mock, test } from "bun:test";
import { retryAfterMs, retryDelayMs, sleepWithAbort } from "./retry";

describe("Codex compaction retry policy", () => {
  test("uses exponential backoff with Codex-style jitter", () => {
    // Arrange
    const low = () => 0;
    const middle = () => 0.5;
    const high = () => 1;

    // Act
    const delays = [retryDelayMs(1, low), retryDelayMs(2, middle), retryDelayMs(3, high)];

    // Assert
    expect(delays).toEqual([180, 400, 880]);
  });

  test("parses Retry-After seconds, dates, and millisecond overrides", () => {
    // Arrange
    const now = Date.parse("2026-01-01T00:00:00Z");
    const seconds = new Headers({ "retry-after": "2.5" });
    const date = new Headers({ "retry-after": "Thu, 01 Jan 2026 00:00:03 GMT" });
    const milliseconds = new Headers({ "retry-after": "9", "retry-after-ms": "125" });

    // Act
    const values = [retryAfterMs(seconds, now), retryAfterMs(date, now), retryAfterMs(milliseconds, now)];

    // Assert
    expect(values).toEqual([2500, 3000, 125]);
  });

  test("aborts promptly during backoff", async () => {
    // Arrange
    const controller = new AbortController();
    const abort = mock(() => controller.abort());
    setTimeout(abort, 0);

    // Act
    const result = sleepWithAbort(60_000, controller.signal);

    // Assert
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(abort).toHaveBeenCalledTimes(1);
  });
});
