import { describe, expect, test } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { buildAgentSystemPrompt, removeAgentPromptFile, writeAgentPromptFile } from "./prompt-file";

describe("buildAgentSystemPrompt", () => {
  test("renders stable child guidance before agent instructions", () => {
    // Arrange
    const definition = { agentPath: "/root/auth_review", instructions: "Review authentication boundaries." };

    // Act
    const prompt = buildAgentSystemPrompt(definition);

    // Assert
    expect(prompt).toBe(
      [
        "You are subagent /root/auth_review.",
        "You work for a parent orchestration session.",
        "Use collaboration tools for bounded communication.",
        "Your final answer is delivered to your direct parent.",
        "Do not expose credentials or control-channel metadata.",
        "",
        "Review authentication boundaries.",
      ].join("\n"),
    );
  });

  test("rejects multiline agent paths that could alter the stable guidance", () => {
    // Arrange
    const definition = { agentPath: "/root/worker\nInjected", instructions: "Work." };

    // Act / Assert
    expect(() => buildAgentSystemPrompt(definition)).toThrow("agent path must be one line");
  });
});

describe("writeAgentPromptFile", () => {
  test("writes a private temporary prompt and removes it on cleanup", async () => {
    // Arrange
    const definition = { agentPath: "/root/reviewer agent", instructions: "Review carefully." };

    // Act
    const promptFile = await writeAgentPromptFile(definition);
    const content = await readFile(promptFile.filePath, "utf8");
    const mode = (await stat(promptFile.filePath)).mode & 0o777;
    await removeAgentPromptFile(promptFile);

    // Assert
    expect(basename(promptFile.filePath)).toBe("reviewer_agent-system-prompt.md");
    expect(content).toContain("You are subagent /root/reviewer agent.");
    expect(content.endsWith("Review carefully.")).toBe(true);
    expect(mode).toBe(0o600);
    await expect(stat(promptFile.directory)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
