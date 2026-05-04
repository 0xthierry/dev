import { describe, expect, test } from "bun:test";
import { readFile, rm, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { AgentDefinition } from "../agents/types";
import { writeAgentPromptFile } from "./prompt-file";

describe("writeAgentPromptFile", () => {
  test("writes the agent system prompt to a private temporary file", async () => {
    // Arrange
    const agent = agentDefinition("reviewer agent", "Review carefully.", "Fallback description");

    // Act
    const promptFile = await writeAgentPromptFile(agent);

    try {
      // Assert
      expect(basename(promptFile.filePath)).toBe("reviewer_agent-system-prompt.md");
      expect(await readFile(promptFile.filePath, "utf8")).toBe("Review carefully.");
      expect((await stat(promptFile.filePath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(promptFile.dir, { recursive: true, force: true });
    }
  });

  test("falls back to the agent description when the body is empty", async () => {
    // Arrange
    const agent = agentDefinition("reviewer", "", "Review code safely.");

    // Act
    const promptFile = await writeAgentPromptFile(agent);

    try {
      // Assert
      expect(await readFile(promptFile.filePath, "utf8")).toBe("Review code safely.");
    } finally {
      await rm(promptFile.dir, { recursive: true, force: true });
    }
  });
});

function agentDefinition(name: string, systemPrompt: string, description: string): AgentDefinition {
  return {
    name,
    description,
    systemPrompt,
    filePath: `/agents/${name}.md`,
    source: "user",
    frontmatter: { name, description },
  };
}
