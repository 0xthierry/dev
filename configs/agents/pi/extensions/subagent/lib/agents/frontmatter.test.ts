import { describe, expect, test } from "bun:test";
import { parseAgentMarkdown, parseDiscoveredAgentMarkdown } from "./frontmatter";

describe("parseAgentMarkdown", () => {
  test("parses an atomic model and exact effort", () => {
    // Arrange
    const markdown = [
      "---",
      "name: worker",
      "description: Implements changes",
      "provider: openai-codex",
      "model: gpt-5.4",
      "effort: xhigh",
      "---",
      "Implement the bounded task.",
    ].join("\n");

    // Act
    const result = parseAgentMarkdown(markdown, ".pi/agents/worker.md", "project");

    // Assert
    expect(result).toEqual({
      name: "worker",
      description: "Implements changes",
      systemPrompt: "Implement the bounded task.",
      sourcePath: ".pi/agents/worker.md",
      source: "project",
      execution: { provider: "openai-codex", model: "gpt-5.4", effort: "xhigh" },
    });
  });

  test("normalizes YAML block-scalar descriptions like Codex role loading", () => {
    // Arrange
    const markdown = [
      "---",
      "name: analyzer",
      "description: |",
      "  Analyzes implementation details.",
      "  Use for deep code tracing.",
      "---",
      "Analyze the codebase.",
    ].join("\n");

    // Act
    const result = parseAgentMarkdown(markdown, "global://rpi/codebase-analyzer.md", "global");

    // Assert
    expect(result.description).toBe("Analyzes implementation details.\nUse for deep code tracing.");
  });

  test("skips ordinary Markdown files that are not agent definitions", () => {
    // Arrange
    const markdown = "# RPI agents\n\nDocumentation for the role directory.";

    // Act
    const result = parseDiscoveredAgentMarkdown(markdown, "global://rpi/readme.md", "global");

    // Assert
    expect(result).toBeUndefined();
  });

  test("rejects incomplete and malformed profiles", () => {
    // Arrange
    const incomplete = "---\nname: bad\ndescription: Bad\nmodel: gpt\n---\nPrompt";
    const clamped = "---\nname: bad\ndescription: Bad\neffort: HIGH\n---\nPrompt";

    // Act
    const parseIncomplete = () => parseAgentMarkdown(incomplete, "global://bad.md", "global");
    const parseClamped = () => parseAgentMarkdown(clamped, "global://bad.md", "global");

    // Assert
    expect(parseIncomplete).toThrow("provider and model must be specified together");
    expect(parseClamped).toThrow("effort must be one of");
  });

  test("rejects unknown frontmatter without restricting trusted role text", () => {
    // Arrange
    const unknown = "---\nname: bad\ndescription: Bad\nsecret: leaked\n---\nPrompt";
    const description = "d".repeat(8 * 1024);
    const detailed = `---\nname: detailed-role\ndescription: ${description}\n---\nPrompt`;

    // Act
    const parseUnknown = () => parseAgentMarkdown(unknown, "global://bad.md", "global");
    const parsed = parseAgentMarkdown(detailed, "global://detailed-role.md", "global");

    // Assert
    expect(parseUnknown).toThrow("unknown fields: secret");
    expect(parsed.description).toBe(description);
  });
});
