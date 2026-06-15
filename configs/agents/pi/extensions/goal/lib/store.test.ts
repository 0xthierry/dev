import { describe, expect, test } from "bun:test";
import { createGoalState, userObjectiveToCreationInput } from "./goal-state";
import { latestGoalFromEntries, stateEntry } from "./store";
import { GOAL_STATE_ENTRY } from "./types";

describe("goal store", () => {
  test("restores the latest valid goal state entry", () => {
    // Arrange
    const first = createGoalState(userObjectiveToCreationInput("finish first until tests pass"), "g1");
    const second = createGoalState(userObjectiveToCreationInput("finish second until tests pass"), "g2");
    const entries = [
      { type: "custom", customType: GOAL_STATE_ENTRY, data: stateEntry(first) },
      { type: "custom", customType: GOAL_STATE_ENTRY, data: stateEntry(second) },
    ];

    // Act
    const result = latestGoalFromEntries(entries);

    // Assert
    expect(result?.id).toBe("g2");
  });
});
