import { describe, expect, test } from "bun:test";
import { buildCodexFetchPrompt, buildCodexSearchPrompt, codexArgs } from "./codex";

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
