import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { isRateLimitText, parseRateLimitDelayFromText, parseRetryAfterMs, rateLimitRetryDelayMs } from "./rate-limit";

afterEach(() => {
  setSystemTime();
});

describe("parseRetryAfterMs", () => {
  test("parses retry-after seconds and dates", () => {
    // Arrange
    setSystemTime(new Date("2026-05-01T00:00:00Z"));
    const seconds = new Headers({ "retry-after": "2" });
    const date = new Headers({ "retry-after": "Fri, 01 May 2026 00:00:05 GMT" });

    // Act
    const secondsDelay = parseRetryAfterMs(seconds);
    const dateDelay = parseRetryAfterMs(date);

    // Assert
    expect(secondsDelay).toBe(2_000);
    expect(dateDelay).toBe(5_000);
  });
});

describe("parseRateLimitDelayFromText", () => {
  test("parses retry guidance from provider text", () => {
    // Arrange
    const messages = ["Retry after 3 seconds", "try again in 250 ms", "Please wait 2 minutes"];

    // Act
    const delays = messages.map(parseRateLimitDelayFromText);

    // Assert
    expect(delays).toEqual([3_000, 250, 120_000]);
  });
});

describe("isRateLimitText", () => {
  test("recognizes common rate-limit messages", () => {
    // Arrange
    const messages = ["rate limit exceeded", "Too many requests", "HTTP 429", "network failed"];

    // Act
    const results = messages.map(isRateLimitText);

    // Assert
    expect(results).toEqual([true, true, true, false]);
  });
});

describe("rateLimitRetryDelayMs", () => {
  test("uses parsed delays only when they are within the configured retry budget", () => {
    // Arrange
    const shortHeaders = new Headers({ "retry-after": "1" });
    const longHeaders = new Headers({ "retry-after": "30" });

    // Act
    const shortDelay = rateLimitRetryDelayMs({ defaultDelayMs: 500, maxDelayMs: 10_000, headers: shortHeaders });
    const defaultDelay = rateLimitRetryDelayMs({ defaultDelayMs: 500, maxDelayMs: 10_000 });
    const skippedDelay = rateLimitRetryDelayMs({ defaultDelayMs: 500, maxDelayMs: 10_000, headers: longHeaders });

    // Assert
    expect(shortDelay).toBe(1_000);
    expect(defaultDelay).toBe(500);
    expect(skippedDelay).toBeUndefined();
  });
});
