import { describe, expect, test } from "bun:test";
import { createGoalState, userObjectiveToCreationInput } from "./goal-state";
import { activeGoalContextPrompt, buildAuditorPrompt, continuationPrompt } from "./prompts";

describe("goal prompts", () => {
  test("injects active goal as user-provided data", () => {
    // Arrange
    const goal = createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1");

    // Act
    const result = activeGoalContextPrompt(goal);

    // Assert
    expect(result).toContain("user-provided task data");
    expect(result).toContain("<untrusted_goal_contract>");
    expect(result).toContain("independent auditor");
  });

  test("builds continuation prompt with audit rules", () => {
    // Arrange
    const goal = createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1");

    // Act
    const result = continuationPrompt(goal);

    // Assert
    expect(result).toContain("Continue concrete work");
    expect(result).toContain("Only call update_goal");
  });

  test("copies skeptical auditor marker requirements", () => {
    // Arrange
    const goal = createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1");

    // Act
    const result = buildAuditorPrompt({
      goal,
      completionClaim: { summary: "done", evidenceRefs: ["bun test"], claimedAt: "2026-01-01T00:00:00.000Z" },
      detailedSummary: "summary",
    });

    // Assert
    expect(result).toContain("<approved/>");
    expect(result).toContain("<disapproved/>");
    expect(result).toContain("Disapprove if any requirement is missing");
  });
});
