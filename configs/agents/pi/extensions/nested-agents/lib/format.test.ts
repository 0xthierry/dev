import { describe, expect, test } from "bun:test";
import { formatAgentsContext, formatLoadedNotification } from "./format";
import type { AgentsContextFile } from "./types";

function contextFile(overrides: Partial<AgentsContextFile>): AgentsContextFile {
  return {
    key: overrides.path ?? "/repo/AGENTS.md",
    path: overrides.path ?? "/repo/AGENTS.md",
    relativePath: overrides.relativePath ?? "AGENTS.md",
    filename: overrides.filename ?? "AGENTS.md",
    content: overrides.content ?? "Follow repo rules.",
  };
}

describe("formatAgentsContext", () => {
  test("formats context files in stable parent-before-child order", () => {
    // Arrange
    const files = [
      contextFile({ relativePath: "tests/unit/CLAUDE.md", filename: "CLAUDE.md", content: "Prefer unit fixtures." }),
      contextFile({ relativePath: "tests/AGENTS.md", content: "Use test helpers." }),
    ];

    // Act
    const result = formatAgentsContext(files);

    // Assert
    expect(result).toContain("# Nested Agent Instructions");
    expect(result.indexOf("## Scope: tests")).toBeLessThan(result.indexOf("## Scope: tests/unit"));
    expect(result.indexOf("Use test helpers.")).toBeLessThan(result.indexOf("Prefer unit fixtures."));
    expect(result).not.toContain("CLAUDE.md");
  });

  test("labels empty context files", () => {
    // Arrange
    const files = [contextFile({ content: "" })];

    // Act
    const result = formatAgentsContext(files);

    // Assert
    expect(result).toContain("[Empty context file]");
  });
});

describe("formatLoadedNotification", () => {
  test("formats loaded context paths", () => {
    // Arrange
    const files = [contextFile({ relativePath: "tests/AGENTS.md" })];

    // Act
    const result = formatLoadedNotification(files);

    // Assert
    expect(result).toBe("Loaded nested agent context: tests/AGENTS.md");
  });
});
