import { describe, expect, test } from "bun:test";
import { prepareWorkflowOutput, textFromContentParts } from "./output";

describe("workflow output helpers", () => {
  test("extracts text content parts", () => {
    // Arrange
    const content = [{ type: "text", text: "one" }, { type: "image" }, { type: "text", text: "two" }];

    // Act
    const text = textFromContentParts(content);

    // Assert
    expect(text).toBe("one\ntwo");
  });

  test("adds an artifact notice when an artifact path is present", () => {
    // Arrange
    const output = "short output";

    // Act
    const result = prepareWorkflowOutput(output, "/tmp/output.md");

    // Assert
    expect(result.text).toContain("short output");
    expect(result.text).toContain("Detailed workflow agent output saved to: /tmp/output.md");
    expect(result.truncated).toBe(false);
  });
});
