import { describe, expect, test } from "bun:test";
import {
  AGENT_ARTIFACT_OUTPUT_PREVIEW_MAX_LINES,
  AGENT_OUTPUT_PREVIEW_MAX_BYTES,
  prepareAgentOutput,
  textFromContentParts,
} from "./output";

describe("prepareAgentOutput", () => {
  test("keeps short output unchanged", () => {
    // Arrange
    const output = "short result";

    // Act
    const result = prepareAgentOutput(output);

    // Assert
    expect(result).toEqual({ text: "short result", truncated: false });
  });

  test("truncates large output", () => {
    // Arrange
    const output = "x".repeat(AGENT_OUTPUT_PREVIEW_MAX_BYTES + 100);

    // Act
    const result = prepareAgentOutput(output);

    // Assert
    expect(result.truncated).toBe(true);
    expect(result.text).toContain("Output preview truncated");
    expect(result.text.length).toBeLessThan(output.length);
  });

  test("keeps parent-visible artifact output compact", () => {
    // Arrange
    const output = "x".repeat(AGENT_OUTPUT_PREVIEW_MAX_BYTES * 3);

    // Act
    const result = prepareAgentOutput(output, "/agent/artifacts/output.md");

    // Assert
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThan(output.length);
    expect(result.text).toContain("Output preview truncated");
    expect(result.text).toContain("Detailed subagent output saved to: /agent/artifacts/output.md");
  });

  test("uses a very small preview for artifact-backed output", () => {
    // Arrange
    const output = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join("\n");

    // Act
    const result = prepareAgentOutput(output, "/agent/artifacts/output.md");

    // Assert
    expect(result.truncated).toBe(true);
    expect(result.text.split("\n").length).toBeLessThanOrEqual(AGENT_ARTIFACT_OUTPUT_PREVIEW_MAX_LINES + 4);
    expect(result.text).toContain("Output preview truncated");
    expect(result.text).toContain("Detailed subagent output saved to: /agent/artifacts/output.md");
  });

  test("appends artifact paths to short output", () => {
    // Arrange
    const output = "short result";

    // Act
    const result = prepareAgentOutput(output, "/agent/artifacts/output.md");

    // Assert
    expect(result).toEqual({
      text: "short result\n\nDetailed subagent output saved to: /agent/artifacts/output.md",
      truncated: false,
    });
  });
});

describe("textFromContentParts", () => {
  test("joins text content parts", () => {
    // Arrange
    const content = [
      { type: "text", text: "first" },
      { type: "thinking", thinking: "hidden" },
      { type: "text", text: "second" },
    ];

    // Act
    const result = textFromContentParts(content);

    // Assert
    expect(result).toBe("first\nsecond");
  });
});
