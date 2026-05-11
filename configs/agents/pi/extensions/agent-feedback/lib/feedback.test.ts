import { describe, expect, test } from "bun:test";
import { formatFeedbackEntry, formatLocalTimestamp, normalizeFeedbackInput } from "./feedback";

const validInput = {
  category: "verification_blocker",
  summary: "Docker daemon unavailable",
  impact: "Could not run the deployment smoke test.",
};

describe("normalizeFeedbackInput", () => {
  test("normalizes structured feedback", () => {
    // Arrange
    const input = {
      ...validInput,
      summary: "  Docker daemon unavailable\r\n",
      attempted: " ran docker ps ",
      blocker: "DOCKER_HOST was not configured",
      suggestedFix: "Document the local Docker requirement.",
    };

    // Act
    const result = normalizeFeedbackInput(input);

    // Assert
    expect(result).toEqual({
      ok: true,
      feedback: {
        category: "verification_blocker",
        summary: "Docker daemon unavailable",
        impact: "Could not run the deployment smoke test.",
        attempted: "ran docker ps",
        blocker: "DOCKER_HOST was not configured",
        suggestedFix: "Document the local Docker requirement.",
      },
    });
  });

  test("redacts obvious secret-shaped values before returning feedback", () => {
    // Arrange
    const input = {
      ...validInput,
      summary: "Provider failed with api_key=sk-abcdefghijklmnopqrstuvwxyz",
      blocker: "Authorization: Bearer abcdefghijklmnop",
      suggestedFix: "Rotate ghp_abcdefghijklmnopqrstuvwxyz token and retry.",
    };

    // Act
    const result = normalizeFeedbackInput(input);

    // Assert
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected valid feedback");
    expect(result.feedback.summary).toBe("Provider failed with api_key=[REDACTED]");
    expect(result.feedback.blocker).toBe("Authorization: [REDACTED]");
    expect(result.feedback.suggestedFix).toBe("Rotate [REDACTED] token and retry.");
  });

  test("rejects unknown categories", () => {
    // Arrange
    const input = { ...validInput, category: "complaint" };

    // Act
    const result = normalizeFeedbackInput(input);

    // Assert
    expect(result).toEqual({
      ok: false,
      error: {
        code: "INVALID_CATEGORY",
        message:
          "agent_feedback.category must be one of: verification_blocker, tooling_friction, instruction_gap, docs_gap, environment_gap, repeated_workaround, other.",
      },
    });
  });

  test("rejects empty required fields", () => {
    // Arrange
    const input = { ...validInput, impact: "  " };

    // Act
    const result = normalizeFeedbackInput(input);

    // Assert
    expect(result).toEqual({
      ok: false,
      error: { code: "EMPTY_IMPACT", message: "agent_feedback.impact must be a non-empty string." },
    });
  });
});

describe("formatLocalTimestamp", () => {
  test("formats a local timestamp without seconds", () => {
    // Arrange
    const date = new Date(2026, 4, 11, 9, 7, 30);

    // Act
    const timestamp = formatLocalTimestamp(date);

    // Assert
    expect(timestamp).toBe("2026-05-11 09:07");
  });
});

describe("formatFeedbackEntry", () => {
  test("renders markdown with optional sections", () => {
    // Arrange
    const feedback = {
      category: "repeated_workaround" as const,
      summary: "Generated files had to be deleted twice.",
      impact: "Validation took longer and could leave stale artifacts.",
      attempted: "Deleted the generated file and reran the command.",
      suggestedFix: "Make the hook clean generated files before regenerating.",
    };

    // Act
    const entry = formatFeedbackEntry(feedback, "2026-05-11 09:07");

    // Assert
    expect(entry).toBe(
      [
        "## 2026-05-11 09:07 — repeated_workaround",
        "",
        "Summary: Generated files had to be deleted twice.",
        "",
        "Impact: Validation took longer and could leave stale artifacts.",
        "",
        "Attempted:",
        "Deleted the generated file and reran the command.",
        "",
        "Suggested fix:",
        "Make the hook clean generated files before regenerating.",
        "",
        "",
      ].join("\n"),
    );
  });
});
