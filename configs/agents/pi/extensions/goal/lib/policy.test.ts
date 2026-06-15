import { describe, expect, test } from "bun:test";
import { createGoalState, userObjectiveToCreationInput } from "./goal-state";
import { applyTurnLimit, validateGoalCreation, validateUpdateGoalBlocked } from "./policy";

describe("goal policy", () => {
  test("rejects vague goal creation", () => {
    // Arrange
    const input = userObjectiveToCreationInput("fix it");

    // Act
    const result = validateGoalCreation(input, null);

    // Assert
    expect(result).toEqual({
      ok: false,
      message: "Goal objective is too vague. Include a concrete deliverable and a verifiable stopping condition.",
    });
  });

  test("rejects model creation while unfinished goal exists", () => {
    // Arrange
    const existing = createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1");
    const input = userObjectiveToCreationInput("finish docs until review is complete");

    // Act
    const result = validateGoalCreation(input, existing);

    // Assert
    expect(result.ok).toBe(false);
  });

  test("requires repeated blocked turns before blocked status", () => {
    // Arrange
    const goal = createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1");

    // Act
    const result = validateUpdateGoalBlocked({
      goal,
      reason: "missing credentials",
      evidenceRefs: ["bash: auth failed"],
      suggestedUserAction: "provide credentials",
    });

    // Assert
    expect(result.ok).toBe(false);
  });

  test("marks active goal limited when turn limit is reached", () => {
    // Arrange
    const goal = {
      ...createGoalState(userObjectiveToCreationInput("finish migration until tests pass", { turnBudget: 1 }), "g1"),
      turnsUsed: 1,
    };

    // Act
    const result = applyTurnLimit(goal, "2026-01-01T00:00:01.000Z");

    // Assert
    expect(result.status).toBe("budget_limited");
    expect(result.autoContinue).toBe(false);
  });
});
