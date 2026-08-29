import { describe, expect, test } from "bun:test";
import {
  AGENT_OUTPUT_PREVIEW_MAX_BYTES,
  AGENT_OUTPUT_PREVIEW_MAX_LINES,
  prepareAgentAggregateOutput,
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

  test("truncates oversized artifact-backed output and tells the parent where to read the rest", () => {
    // Arrange
    const output = "x".repeat(AGENT_OUTPUT_PREVIEW_MAX_BYTES * 3);

    // Act
    const result = prepareAgentOutput(output, "/agent/artifacts/output.md");

    // Assert
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThan(output.length);
    expect(result.text).toContain("Output preview truncated");
    expect(result.text).toContain("Read the full report at: /agent/artifacts/output.md");
    expect(result.text).not.toContain("Detailed subagent output saved to:");
  });

  test("keeps a typical full report inline for artifact-backed output", () => {
    // Arrange
    const output = Array.from({ length: AGENT_OUTPUT_PREVIEW_MAX_LINES - 1 }, (_, index) => `line ${index + 1}`).join(
      "\n",
    );

    // Act
    const result = prepareAgentOutput(output, "/agent/artifacts/output.md");

    // Assert
    expect(result.truncated).toBe(false);
    expect(result.text).toContain(`line ${AGENT_OUTPUT_PREVIEW_MAX_LINES - 1}`);
    expect(result.text).toContain("Detailed subagent output saved to: /agent/artifacts/output.md");
  });

  test("truncates reports past the line budget", () => {
    // Arrange
    const output = Array.from({ length: AGENT_OUTPUT_PREVIEW_MAX_LINES + 50 }, (_, index) => `line ${index + 1}`).join(
      "\n",
    );

    // Act
    const result = prepareAgentOutput(output, "/agent/artifacts/output.md");

    // Assert
    expect(result.truncated).toBe(true);
    expect(result.text.split("\n").length).toBeLessThanOrEqual(AGENT_OUTPUT_PREVIEW_MAX_LINES + 4);
    expect(result.text).toContain("Output preview truncated");
    expect(result.text).toContain("Read the full report at: /agent/artifacts/output.md");
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

describe("prepareAgentAggregateOutput", () => {
  test("keeps short aggregate output unchanged", () => {
    // Arrange
    const output = "Parallel agents completed: 2/2 succeeded.";

    // Act
    const result = prepareAgentAggregateOutput(output);

    // Assert
    expect(result).toEqual({ text: output, truncated: false });
  });

  test("keeps byte-limited aggregate output within policy and marks retained tail", () => {
    // Arrange
    const retainedTail = "retained final agent output";
    const output = `${"x".repeat(AGENT_OUTPUT_PREVIEW_MAX_BYTES)}${retainedTail}`;

    // Act
    const result = prepareAgentAggregateOutput(output);

    // Assert
    expect(result.truncated).toBe(true);
    expect(new TextEncoder().encode(result.text).byteLength).toBeLessThanOrEqual(AGENT_OUTPUT_PREVIEW_MAX_BYTES);
    expect(result.text.split("\n")).toHaveLength(3);
    expect(result.text).toContain(retainedTail);
    expect(result.text).toContain("Parallel subagent aggregate truncated");
  });

  test("keeps line-limited aggregate output within policy and marks truncation", () => {
    // Arrange
    const output = Array.from(
      { length: AGENT_OUTPUT_PREVIEW_MAX_LINES + 50 },
      (_, index) => `aggregate line ${index + 1}`,
    ).join("\n");

    // Act
    const result = prepareAgentAggregateOutput(output);

    // Assert
    expect(result.truncated).toBe(true);
    expect(result.text.split("\n").length).toBeLessThanOrEqual(AGENT_OUTPUT_PREVIEW_MAX_LINES);
    expect(new TextEncoder().encode(result.text).byteLength).toBeLessThanOrEqual(AGENT_OUTPUT_PREVIEW_MAX_BYTES);
    expect(result.text).toContain(`aggregate line ${AGENT_OUTPUT_PREVIEW_MAX_LINES + 50}`);
    expect(result.text).toContain("Parallel subagent aggregate truncated");
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
