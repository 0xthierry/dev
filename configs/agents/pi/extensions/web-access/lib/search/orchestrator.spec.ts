import { describe, expect, test } from "bun:test";
import { search } from "./orchestrator";

describe("web-access search live orchestration", () => {
  test("returns current web results through the configured provider chain", async () => {
    const result = await search("Example Domain official website", { numResults: 2 });

    expect(["exa", "brave", "tavily", "codex"]).toContain(result.provider);
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0]?.url).toStartWith("http");
  }, 150_000);
});
