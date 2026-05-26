import { describe, expect, test } from "bun:test";
import { MAX_PARALLEL_AGENT_TASKS, planAgentInvocation } from "./params";

describe("planAgentInvocation", () => {
  test("plans a single agent invocation", () => {
    // Arrange
    const params = {
      subagent_type: " reviewer ",
      prompt: " Review diff ",
      description: " Review ",
      effort: "high" as const,
    };

    // Act
    const result = planAgentInvocation(params);

    // Assert
    expect(result).toEqual({
      ok: true,
      plan: {
        mode: "single",
        tasks: [
          {
            kind: "start",
            subagentType: "reviewer",
            prompt: "Review diff",
            description: "Review",
            context: "fresh",
            effort: "high",
          },
        ],
      },
    });
  });

  test("plans parallel agent tasks with top-level defaults", () => {
    // Arrange
    const params = {
      context: "fork" as const,
      effort: "low" as const,
      tasks: [
        { subagent_type: "locator", prompt: "Find auth files" },
        { subagent_type: "reviewer", prompt: "Review auth", context: "fresh" as const, effort: "high" as const },
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
          {
            kind: "start",
            subagentType: "locator",
            prompt: "Find auth files",
            description: undefined,
            context: "fork",
            effort: "low",
          },
          {
            kind: "start",
            subagentType: "reviewer",
            prompt: "Review auth",
            description: undefined,
            context: "fresh",
            effort: "high",
          },
        ],
      },
    });
  });

  test("plans a resume invocation", () => {
    // Arrange
    const params = {
      agent_id: " 019e1882 ",
      prompt: " Continue review ",
      subagent_type: "reviewer",
      effort: "minimal" as const,
    };

    // Act
    const result = planAgentInvocation(params);

    // Assert
    expect(result).toEqual({
      ok: true,
      plan: {
        mode: "single",
        tasks: [
          {
            kind: "resume",
            agentId: "019e1882",
            subagentType: "reviewer",
            prompt: "Continue review",
            description: undefined,
            context: "resume",
            effort: "minimal",
          },
        ],
      },
    });
  });

  test("plans parallel tasks mixing new and resumed agents", () => {
    // Arrange
    const params = {
      tasks: [
        { subagent_type: "locator", prompt: "Find files" },
        { agent_id: "019e1882", prompt: "Continue the previous review" },
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
          { kind: "start", subagentType: "locator", prompt: "Find files", description: undefined, context: "fresh" },
          {
            kind: "resume",
            agentId: "019e1882",
            subagentType: undefined,
            prompt: "Continue the previous review",
            description: undefined,
            context: "resume",
          },
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
    expect(result).toEqual({ ok: false, error: "Provide exactly one agent mode: subagent_type + prompt, or tasks[]." });
  });

  test("rejects malformed parallel tasks without throwing", () => {
    // Arrange
    const params = { tasks: [undefined] } as unknown as Parameters<typeof planAgentInvocation>[0];

    // Act
    const result = planAgentInvocation(params);

    // Assert
    expect(result).toEqual({ ok: false, error: "Provide exactly one agent mode: subagent_type + prompt, or tasks[]." });
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
    if (!result.ok) expect(result.error).toContain("Too many parallel agent tasks");
  });
});
