import { describe, expect, test } from "bun:test";
import { parseComputerUseCode, summarizeComputerUseCode } from "./tool";

describe("Computer Use code input", () => {
  test("extracts code from the exact tool input shape", () => {
    // Arrange
    const input = { code: "emit(await sky.list_apps());" };

    // Act
    const code = parseComputerUseCode(input);

    // Assert
    expect(code).toBe(input.code);
    expect(() => parseComputerUseCode({})).toThrow();
  });

  test("summarizes the first non-empty code line and bounds its length", () => {
    // Arrange
    const firstLine = `await sky.type_text(${"x".repeat(120)})`;
    const input = { code: `\n  \n  ${firstLine}\nemit("done");` };

    // Act
    const summary = summarizeComputerUseCode(input);
    const invalidSummary = summarizeComputerUseCode({ value: "not code" });

    // Assert
    expect(summary).toBe(firstLine.slice(0, 100));
    expect(invalidSummary).toBeUndefined();
  });
});
