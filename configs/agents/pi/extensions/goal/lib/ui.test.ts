import { describe, expect, test } from "bun:test";
import { createGoalState, userObjectiveToCreationInput } from "./goal-state";
import { formatGoalAuditorStatus, formatGoalDetails, formatGoalStatus } from "./ui";

describe("goal UI formatting", () => {
  test("formats absent goal details", () => {
    // Arrange
    const goal = null;

    // Act
    const result = formatGoalDetails(goal);

    // Assert
    expect(result).toContain("No goal is set");
  });

  test("formats compact goal status", () => {
    // Arrange
    const goal = createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1");

    // Act
    const result = formatGoalStatus(goal);

    // Assert
    expect(result).toContain("goal: active");
    expect(result).toContain("turns");
  });

  test("formats real auditor status with model and latest audit", () => {
    // Arrange
    const goal = {
      ...createGoalState(userObjectiveToCreationInput("finish migration until tests pass"), "g1"),
      auditAttempts: 1,
      completionClaim: {
        summary: "done",
        evidenceRefs: ["bun test"],
        claimedAt: "2026-01-01T00:00:00.000Z",
      },
      auditResults: [
        {
          verdict: "disapproved" as const,
          report: "missing evidence",
          at: "2026-01-01T00:00:01.000Z",
          model: "fake/model",
        },
      ],
    };
    const model = { provider: "openai", id: "gpt-5.1" };

    // Act
    const result = formatGoalAuditorStatus(goal, model);

    // Assert
    expect(result).toContain("Goal auditor: mandatory");
    expect(result).toContain("Model: openai/gpt-5.1");
    expect(result).toContain("Audit attempts: 1");
    expect(result).toContain("Latest audit: disapproved");
    expect(result).toContain("Latest audit report: missing evidence");
  });
});
