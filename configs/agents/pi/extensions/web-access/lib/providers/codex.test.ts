import { afterEach, describe, expect, mock, test } from "bun:test";
import {
  buildCodexFetchPrompt,
  buildCodexSearchPrompt,
  type CodexRunner,
  codexArgs,
  codexRateLimitDelayMs,
  runCodex,
} from "./codex";

afterEach(() => {
  mock.clearAllMocks();
});

describe("Codex fallback prompt builders", () => {
  test("builds search prompts with recency and domain filters", () => {
    // Arrange
    const options = {
      numResults: 50,
      recencyFilter: "week" as const,
      domainFilter: ["example.com", "-spam.test"],
    };

    // Act
    const prompt = buildCodexSearchPrompt("latest pi release", options);

    // Assert
    expect(prompt).toContain("Limit to about 20 sources.");
    expect(prompt).toContain("Prefer sources from the past week.");
    expect(prompt).toContain("Only use sources from these domains: example.com.");
    expect(prompt).toContain("Do not use sources from these domains: spam.test.");
    expect(prompt).toContain("Query: latest pi release");
  });

  test("builds fetch prompts with optional user instructions", () => {
    // Arrange
    const url = "https://example.com";
    const instructions = "focus on APIs";

    // Act
    const prompt = buildCodexFetchPrompt(url, instructions);

    // Assert
    expect(prompt).toContain("extract readable content as markdown");
    expect(prompt).toContain("User prompt: focus on APIs");
    expect(prompt).toContain("URL: https://example.com");
  });

  test("builds read-only codex exec arguments", () => {
    // Arrange
    const prompt = "Prompt";
    const cwd = "/tmp/work";

    // Act
    const args = codexArgs(prompt, cwd);

    // Assert
    expect(args).toEqual([
      "exec",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--ephemeral",
      "--color",
      "never",
      "-C",
      "/tmp/work",
      "Prompt",
    ]);
  });
});

describe("Codex rate-limit handling", () => {
  test("parses retry delays from Codex CLI rate-limit errors", () => {
    // Arrange
    const err = Object.assign(new Error("429 Too Many Requests. Retry after 3 seconds."), { stderr: "" });

    // Act
    const delay = codexRateLimitDelayMs(err);

    // Assert
    expect(delay).toBe(3_000);
  });

  test("retries Codex CLI once for short rate limits", async () => {
    // Arrange
    const outcomes: Array<Promise<{ stdout: string; stderr: string }>> = [
      Promise.reject(Object.assign(new Error("Too many requests. Retry after 0 seconds."), { stderr: "" })),
      Promise.resolve({ stdout: "# Answer\n\nSource: https://example.com", stderr: "" }),
    ];
    const runner: CodexRunner = {
      execFileText: mock(async () => outcomes.shift() ?? Promise.reject(new Error("unexpected call"))),
      waitForRateLimit: mock(async () => undefined),
    };

    // Act
    const output = await runCodex("Prompt", { cwd: "/tmp/work" }, runner);

    // Assert
    expect(output).toContain("# Answer");
    expect(runner.execFileText).toHaveBeenCalledTimes(2);
    expect(runner.waitForRateLimit).toHaveBeenCalledWith(0, undefined);
  });
});
