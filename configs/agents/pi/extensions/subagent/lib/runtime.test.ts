import { describe, expect, test } from "bun:test";
import type { AgentDefinition } from "./agents/types";
import { findAgent } from "./runtime";

describe("findAgent", () => {
  test("finds an agent by exact name", () => {
    // Arrange
    const agents = [agent("locator"), agent("reviewer")];

    // Act
    const result = findAgent(agents, "reviewer");

    // Assert
    expect(result?.name).toBe("reviewer");
  });
});

function agent(name: string): AgentDefinition {
  return {
    name,
    description: `${name} description`,
    systemPrompt: `${name} prompt`,
    filePath: `/agents/${name}.md`,
    source: "user",
    frontmatter: { name, description: `${name} description` },
  };
}
