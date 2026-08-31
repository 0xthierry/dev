import { describe, expect, test } from "bun:test";
import { appendAgentPromptSection, buildAgentPromptSection } from "./prompt";
import type { AgentDefinition } from "./types";

function agent(name: string, description: string): AgentDefinition {
  return { name, description, systemPrompt: "Prompt", sourcePath: `global://${name}.md`, source: "global" };
}

describe("buildAgentPromptSection", () => {
  test("renders a deterministic sorted catalog without paths or execution state", () => {
    // Arrange
    const agents = [agent("zeta", "Last\nagent"), agent("alpha", "First agent")];

    // Act
    const section = buildAgentPromptSection(agents);

    // Assert
    expect(section.indexOf("- alpha:")).toBeLessThan(section.indexOf("- zeta:"));
    expect(section).toContain("- zeta: Last agent");
    expect(section).not.toContain("global://");
    expect(section).not.toContain("effort");
    expect(agents.map((item) => item.name)).toEqual(["zeta", "alpha"]);
  });
});

describe("appendAgentPromptSection", () => {
  test("appends the stable section with one blank line", () => {
    // Arrange
    const base = "Base\n";
    const section = "## Subagents";

    // Act
    const result = appendAgentPromptSection(base, section);

    // Assert
    expect(result).toBe("Base\n\n## Subagents");
  });
});
