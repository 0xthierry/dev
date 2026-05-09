import { describe, expect, test } from "bun:test";
import { sortAgentsContextFiles } from "./ordering";
import type { AgentsContextFile } from "./types";

function contextFile(relativePath: string, filename = relativePath.split("/").pop() ?? "AGENTS.md"): AgentsContextFile {
  return {
    key: `/repo/${relativePath}`,
    path: `/repo/${relativePath}`,
    relativePath,
    filename,
    content: `${relativePath} instructions`,
  };
}

describe("sortAgentsContextFiles", () => {
  test("sorts context files by stable parent-before-child project order", () => {
    // Arrange
    const files = [
      contextFile("tests/unit/CLAUDE.md"),
      contextFile("src/AGENTS.md"),
      contextFile("AGENTS.md"),
      contextFile("tests/AGENTS.md"),
    ];

    // Act
    const result = sortAgentsContextFiles(files);

    // Assert
    expect(result.map((file) => file.relativePath)).toEqual([
      "AGENTS.md",
      "src/AGENTS.md",
      "tests/AGENTS.md",
      "tests/unit/CLAUDE.md",
    ]);
    expect(files.map((file) => file.relativePath)).toEqual([
      "tests/unit/CLAUDE.md",
      "src/AGENTS.md",
      "AGENTS.md",
      "tests/AGENTS.md",
    ]);
  });

  test("uses Pi context filename precedence inside the same scope", () => {
    // Arrange
    const files = [
      contextFile("pkg/CLAUDE.md", "CLAUDE.md"),
      contextFile("pkg/AGENTS.md", "AGENTS.md"),
      contextFile("pkg/CLAUDE.MD", "CLAUDE.MD"),
      contextFile("pkg/AGENTS.MD", "AGENTS.MD"),
    ];

    // Act
    const result = sortAgentsContextFiles(files);

    // Assert
    expect(result.map((file) => file.filename)).toEqual(["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]);
  });
});
