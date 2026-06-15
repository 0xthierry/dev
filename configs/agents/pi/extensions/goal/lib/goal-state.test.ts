import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  buildCanonicalGoalText,
  createGoalState,
  normalizeGoalState,
  userObjectiveToCreationInput,
} from "./goal-state";

describe("goal state helpers", () => {
  afterEach(() => {
    setSystemTime();
  });

  test("creates a goal with canonical immutable contract text", () => {
    // Arrange
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const input = userObjectiveToCreationInput("finish migration until tests pass");

    // Act
    const result = createGoalState(input, "g1");

    // Assert
    expect(result.id).toBe("g1");
    expect(result.status).toBe("active");
    expect(result.turnBudget).toBe(512);
    expect(result.canonicalText).toContain("Objective:\n- finish migration until tests pass");
    expect(result.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  test("normalizes stored goal state", () => {
    // Arrange
    setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const input = createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1");

    // Act
    const result = normalizeGoalState({ ...input, tokensUsed: 12.9 });

    // Assert
    expect(result?.tokensUsed).toBe(12);
    expect(result?.id).toBe("g1");
  });

  test("builds canonical text from explicit fields", () => {
    // Arrange
    const input = {
      objective: "ship feature until lint passes",
      successCriteria: ["feature works"],
      verificationPlan: ["run lint"],
      constraints: ["no secrets"],
      evidenceSurface: ["lint output"],
      autoContinue: true,
    };

    // Act
    const result = buildCanonicalGoalText(input);

    // Assert
    expect(result).toContain("Success criteria:\n- feature works");
    expect(result).toContain("Expected evidence:\n- lint output");
  });
});
