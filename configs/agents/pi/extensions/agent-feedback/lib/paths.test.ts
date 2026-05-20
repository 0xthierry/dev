import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { buildAgentFeedbackPath } from "./paths";

describe("buildAgentFeedbackPath", () => {
  test("builds the feedback file path in the current working directory", () => {
    // Arrange
    const cwd = "/workspace/project";

    // Act
    const path = buildAgentFeedbackPath(cwd);

    // Assert
    expect(path).toEqual({
      filePath: join(cwd, "agent_feedback.md"),
      displayPath: "agent_feedback.md",
    });
  });

  test("normalizes relative working directories before building the feedback path", () => {
    // Arrange
    const cwd = "configs/../configs/agents";

    // Act
    const path = buildAgentFeedbackPath(cwd);

    // Assert
    expect(path.filePath).toBe(join(resolve("configs/agents"), "agent_feedback.md"));
    expect(path.displayPath).toBe("agent_feedback.md");
  });
});
