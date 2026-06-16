import { describe, expect, test } from "bun:test";
import { createGoalState, mergeAmendment, userObjectiveToCreationInput } from "./goal-state";
import {
  applyStallLimit,
  applyTurnLimit,
  STALL_PAUSE_TURNS,
  validateGoalAmendment,
  validateGoalCreation,
  validateUpdateGoalBlocked,
  validateUpdateGoalPaused,
} from "./policy";

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

  test("accepts blocked status when the external impasse is evidenced", () => {
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
    expect(result.ok).toBe(true);
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

  test("auto-pauses an active goal after the stall limit", () => {
    // Arrange
    const goal = {
      ...createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1"),
      stallTurns: STALL_PAUSE_TURNS,
    };

    // Act
    const result = applyStallLimit(goal, "2026-01-01T00:00:01.000Z");

    // Assert
    expect(result.status).toBe("paused");
    expect(result.autoContinue).toBe(false);
  });

  test("leaves a goal active below the stall limit", () => {
    // Arrange
    const goal = {
      ...createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1"),
      stallTurns: STALL_PAUSE_TURNS - 1,
    };

    // Act
    const result = applyStallLimit(goal, "2026-01-01T00:00:01.000Z");

    // Assert
    expect(result.status).toBe("active");
  });

  test("accepts a pause request with a question for the user", () => {
    // Arrange
    const goal = createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1");

    // Act
    const result = validateUpdateGoalPaused(goal, "Which database should I target, SQLite or Postgres?");

    // Assert
    expect(result.ok).toBe(true);
  });

  test("rejects a pause request with no question", () => {
    // Arrange
    const goal = createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1");

    // Act
    const result = validateUpdateGoalPaused(goal, "   ");

    // Assert
    expect(result.ok).toBe(false);
  });

  test("accepts an amendment that keeps a verifiable stopping condition", () => {
    // Arrange
    const goal = createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1");
    const merged = mergeAmendment(goal, {
      successCriteria: ["Coverage threshold is 70% and the test command passes."],
    });

    // Act
    const result = validateGoalAmendment(goal, merged, "user lowered coverage to 70%");

    // Assert
    expect(result.ok).toBe(true);
  });

  test("rejects an amendment that guts the success criteria", () => {
    // Arrange
    const goal = createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1");
    const merged = mergeAmendment(goal, { successCriteria: ["ok"] });

    // Act
    const result = validateGoalAmendment(goal, merged, "lower the bar");

    // Assert
    expect(result.ok).toBe(false);
  });

  test("rejects an amendment with no reason", () => {
    // Arrange
    const goal = createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1");
    const merged = mergeAmendment(goal, {});

    // Act
    const result = validateGoalAmendment(goal, merged, "   ");

    // Assert
    expect(result.ok).toBe(false);
  });
});
