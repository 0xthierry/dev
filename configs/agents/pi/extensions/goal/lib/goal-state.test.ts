import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  amendGoalState,
  buildCanonicalGoalText,
  createGoalState,
  mergeAmendment,
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

  test("amends the contract in place while preserving identity and counters", () => {
    // Arrange
    const goal = {
      ...createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1"),
      turnsUsed: 40,
      consecutiveBlockedTurns: 3,
      stallTurns: 9,
    };
    const merged = mergeAmendment(goal, {
      successCriteria: ["Coverage threshold is 70% and the test command passes."],
    });

    // Act
    const result = amendGoalState(goal, merged, "user lowered coverage to 70%");

    // Assert
    expect(result.id).toBe("g1");
    expect(result.turnsUsed).toBe(40);
    expect(result.successCriteria).toEqual(["Coverage threshold is 70% and the test command passes."]);
    expect(result.canonicalText).toContain("Coverage threshold is 70%");
    expect(result.lastUpdate).toBe("Goal amended: user lowered coverage to 70%");
    expect(result.consecutiveBlockedTurns).toBe(0);
    expect(result.stallTurns).toBe(0);
  });

  test("keeps untouched fields when merging a partial amendment", () => {
    // Arrange
    const goal = createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1");

    // Act
    const merged = mergeAmendment(goal, { constraints: ["No network access."] });

    // Assert
    expect(merged.objective).toBe(goal.objective);
    expect(merged.successCriteria).toEqual(goal.successCriteria);
    expect(merged.constraints).toEqual(["No network access."]);
  });
});
