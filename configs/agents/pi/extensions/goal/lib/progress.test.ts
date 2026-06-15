import { describe, expect, test } from "bun:test";
import { isMeaningfulProgressToolCall, shouldBlockAfterStop } from "./progress";

describe("goal progress guards", () => {
  test("counts file reads as meaningful progress", () => {
    // Arrange
    const input = { path: "src/index.ts" };

    // Act
    const result = isMeaningfulProgressToolCall("read", input);

    // Assert
    expect(result).toBe(true);
  });

  test("ignores metadata reads and echo commands", () => {
    // Arrange
    const calls = [
      ["read", { path: ".pi/goals/state.json" }],
      ["bash", { command: "echo hello" }],
    ] as const;

    // Act
    const results = calls.map(([tool, input]) => isMeaningfulProgressToolCall(tool, input));

    // Assert
    expect(results).toEqual([false, false]);
  });

  test("blocks mutating tools after lifecycle stop", () => {
    // Arrange
    const tools = ["read", "write", "bash"];

    // Act
    const results = tools.map(shouldBlockAfterStop);

    // Assert
    expect(results).toEqual([false, true, true]);
  });
});
