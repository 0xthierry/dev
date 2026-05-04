import { describe, expect, test } from "bun:test";
import { MAX_PARALLEL_AGENT_TASKS, planAgentInvocation } from "./params";

describe("planAgentInvocation", () => {
  test("plans a single Agent invocation", () => {
    // Arrange
    const params = { subagent_type: " reviewer ", prompt: " Review diff ", description: " Review " };

    // Act
    const result = planAgentInvocation(params);

    // Assert
    expect(result).toEqual({
      ok: true,
      plan: {
        mode: "single",
        tasks: [{ subagentType: "reviewer", prompt: "Review diff", description: "Review", context: "fresh" }],
      },
    });
  });

  test("plans parallel Agent tasks with a top-level context default", () => {
    // Arrange
    const params = {
      context: "fork" as const,
      tasks: [
        { subagent_type: "locator", prompt: "Find auth files" },
        { subagent_type: "reviewer", prompt: "Review auth", context: "fresh" as const },
      ],
    };

    // Act
    const result = planAgentInvocation(params);

    // Assert
    expect(result).toEqual({
      ok: true,
      plan: {
        mode: "parallel",
        tasks: [
          { subagentType: "locator", prompt: "Find auth files", description: undefined, context: "fork" },
          { subagentType: "reviewer", prompt: "Review auth", description: undefined, context: "fresh" },
        ],
      },
    });
  });

  test("rejects ambiguous single and parallel modes", () => {
    // Arrange
    const params = {
      subagent_type: "reviewer",
      prompt: "Review",
      tasks: [{ subagent_type: "locator", prompt: "Find files" }],
    };

    // Act
    const result = planAgentInvocation(params);

    // Assert
    expect(result).toEqual({ ok: false, error: "Provide exactly one Agent mode: subagent_type + prompt, or tasks[]." });
  });

  test("rejects malformed parallel tasks without throwing", () => {
    // Arrange
    const params = { tasks: [undefined] } as unknown as Parameters<typeof planAgentInvocation>[0];

    // Act
    const result = planAgentInvocation(params);

    // Assert
    expect(result).toEqual({ ok: false, error: "Provide exactly one Agent mode: subagent_type + prompt, or tasks[]." });
  });

  test("rejects oversized parallel batches", () => {
    // Arrange
    const tasks = Array.from({ length: MAX_PARALLEL_AGENT_TASKS + 1 }, (_, index) => ({
      subagent_type: `agent-${index}`,
      prompt: "Work",
    }));

    // Act
    const result = planAgentInvocation({ tasks });

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Too many parallel Agent tasks");
  });
});
