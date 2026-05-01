import { describe, expect, test } from "bun:test";
import { searchWithCodex } from "./codex";

describe("web-access Codex live fallback contract", () => {
  test("uses Codex CLI native web search and returns source URLs", async () => {
    const result = await searchWithCodex("Find the official Example Domain website and return only that source URL.", {
      numResults: 1,
      timeoutMs: 120_000,
    });

    expect(result.provider).toBe("codex");
    expect(result.answer.length).toBeGreaterThan(20);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]?.url).toStartWith("http");
  }, 150_000);
});
