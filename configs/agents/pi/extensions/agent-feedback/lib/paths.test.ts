import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { buildAgentFeedbackPath, projectCwdSegments } from "./paths";

describe("buildAgentFeedbackPath", () => {
  test("builds the feedback file path under the configured home directory", () => {
    // Arrange
    const homeDir = "/home/tester";
    const cwd = "/workspace/project";

    // Act
    const path = buildAgentFeedbackPath(cwd, homeDir);

    // Assert
    expect(path).toEqual({
      filePath: join(homeDir, ".pi", "agent", "feedback", "workspace", "project", "agent_feedback.md"),
      displayPath: join("~", ".pi", "agent", "feedback", "workspace", "project", "agent_feedback.md"),
      projectKey: "workspace/project",
    });
  });
});

describe("projectCwdSegments", () => {
  test("normalizes relative working directories before splitting them into feedback path segments", () => {
    // Arrange
    const cwd = "configs/../configs/agents";

    // Act
    const segments = projectCwdSegments(cwd);

    // Assert
    expect(segments.join("/")).toBe(resolve("configs/agents").slice(1));
  });

  test("uses a stable segment for the filesystem root", () => {
    // Arrange
    const cwd = "/";

    // Act
    const segments = projectCwdSegments(cwd);

    // Assert
    expect(segments).toEqual(["_root"]);
  });
});
