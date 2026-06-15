import { describe, expect, test } from "bun:test";
import { parseAuditorDecision } from "./auditor";

describe("parseAuditorDecision", () => {
  test("accepts exact approval marker", () => {
    // Arrange
    const output = "All criteria are proven.\n<approved/>";

    // Act
    const result = parseAuditorDecision(output);

    // Assert
    expect(result).toEqual({ approved: true, disapproved: false });
  });

  test("treats both markers as disapproval", () => {
    // Arrange
    const output = "Confused. <approved/> <disapproved/>";

    // Act
    const result = parseAuditorDecision(output);

    // Assert
    expect(result).toEqual({ approved: false, disapproved: true });
  });
});
