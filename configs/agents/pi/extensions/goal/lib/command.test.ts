import { describe, expect, test } from "bun:test";
import { parseGoalCommand } from "./command";

describe("parseGoalCommand", () => {
  test("parses status by default", () => {
    // Arrange
    const input = "";

    // Act
    const result = parseGoalCommand(input);

    // Assert
    expect(result).toEqual({ kind: "status" });
  });

  test("parses free-form objectives directly", () => {
    // Arrange
    const input = "finish migration until tests pass";

    // Act
    const result = parseGoalCommand(input);

    // Assert
    expect(result).toEqual({ kind: "create", objective: "finish migration until tests pass" });
  });

  test("parses turns command", () => {
    // Arrange
    const input = "turns 512";

    // Act
    const result = parseGoalCommand(input);

    // Assert
    expect(result).toEqual({ kind: "turns", turns: 512 });
  });

  test("rejects invalid turns command", () => {
    // Arrange
    const input = "turns nope";

    // Act
    const result = parseGoalCommand(input);

    // Assert
    expect(result).toEqual({ kind: "invalid", message: "Usage: /goal turns <positive turn count>" });
  });
});
