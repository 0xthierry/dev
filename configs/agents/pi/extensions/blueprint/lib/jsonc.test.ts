import { describe, expect, test } from "bun:test";
import { parseJsonc } from "./jsonc";

describe("parseJsonc", () => {
  test("parses comments and trailing commas", () => {
    // Arrange
    const input = `{
      // blueprint metadata
      "name": "implement",
      "nodes": {
        "done": {
          "type": "stop", /* inline block comment */
        },
      },
    }`;

    // Act
    const result = parseJsonc(input);

    // Assert
    expect(result).toEqual({ ok: true, value: { name: "implement", nodes: { done: { type: "stop" } } } });
  });

  test("preserves comment markers and commas inside strings", () => {
    // Arrange
    const input = `{"text":"not // a comment, and not /* a block */","list":["a,"]}`;

    // Act
    const result = parseJsonc(input);

    // Assert
    expect(result).toEqual({ ok: true, value: { text: "not // a comment, and not /* a block */", list: ["a,"] } });
  });

  test("reports parse errors", () => {
    // Arrange
    const input = "{ invalid";

    // Act
    const result = parseJsonc(input);

    // Assert
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("JSON");
  });
});
