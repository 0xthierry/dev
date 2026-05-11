import { describe, expect, test } from "bun:test";
import { appendAgentPromptSection, buildAgentPromptSection } from "./prompt";
import type { AgentDefinition } from "./types";

describe("buildAgentPromptSection", () => {
  test("lists configured agents", () => {
    // Arrange
    const agents = [agent("locator", "Finds files", "medium"), agent("reviewer", "Reviews code")];

    // Act
    const section = buildAgentPromptSection(agents, "/agents");

    // Assert
    expect(section).toContain("Use the agent tool");
    expect(section).toContain("- locator: Finds files");
    expect(section).toContain("- reviewer: Reviews code");
    expect(section).toContain("normal Pi discovery");
    expect(section).toContain("agent_id");
    expect(section).toContain("compact contract");
    expect(section).not.toContain("override built-in agents");
    expect(section).not.toContain("effort");
  });

  test("returns an empty prompt when no agents exist", () => {
    // Arrange
    const agents: AgentDefinition[] = [];

    // Act
    const section = buildAgentPromptSection(agents, "/tmp/pi/agents");

    // Assert
    expect(section).toBe("");
  });
});

describe("appendAgentPromptSection", () => {
  test("appends the subagent section to the existing system prompt", () => {
    // Arrange
    const systemPrompt = "Base prompt\n";
    const section = "## Subagents";

    // Act
    const result = appendAgentPromptSection(systemPrompt, section);

    // Assert
    expect(result).toBe("Base prompt\n\n## Subagents");
  });

  test("leaves the system prompt unchanged for an empty subagent section", () => {
    // Arrange
    const systemPrompt = "Base prompt\n";
    const section = "";

    // Act
    const result = appendAgentPromptSection(systemPrompt, section);

    // Assert
    expect(result).toBe("Base prompt");
  });
});

function agent(name: string, description: string, effort?: AgentDefinition["effort"]): AgentDefinition {
  return {
    name,
    description,
    systemPrompt: `${name} prompt`,
    filePath: `/agents/${name}.md`,
    source: "user",
    frontmatter: { name, description, ...(effort ? { effort } : {}) },
    ...(effort ? { effort } : {}),
  };
}
