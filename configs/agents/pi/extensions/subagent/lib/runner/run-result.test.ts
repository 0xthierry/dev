import { describe, expect, test } from "bun:test";
import type { AgentDefinition } from "../agents/types";
import type { AgentRunRequest } from "./invocation";
import { createChildAgentEventState } from "./json-events";
import { buildAgentRunResult } from "./run-result";

describe("buildAgentRunResult", () => {
  test("builds a successful child result from assistant output", () => {
    // Arrange
    const state = createChildAgentEventState();
    state.finalOutput = "Agent completed.";
    state.model = "test-model";
    state.stopReason = "stop";
    state.usage.input = 10;
    const request = runRequest("reviewer", "Review diff");

    // Act
    const result = buildAgentRunResult(request, state, 0, "");

    // Assert
    expect(result).toMatchObject({
      agent: "reviewer",
      task: "Review diff",
      context: "fresh",
      status: "succeeded",
      ok: true,
      exitCode: 0,
      finalOutput: "Agent completed.",
      model: "test-model",
      thinking: undefined,
      stopReason: "stop",
    });
    expect(result.usage.input).toBe(10);
    expect(result.activity).toEqual([]);
  });

  test("includes inherited thinking level", () => {
    // Arrange
    const state = createChildAgentEventState();
    state.finalOutput = "Agent completed.";
    state.model = "test-model";
    state.stopReason = "stop";
    const request = { ...runRequest("reviewer", "Review diff"), thinking: "xhigh" as const };

    // Act
    const result = buildAgentRunResult(request, state, 0, "");

    // Assert
    expect(result.thinking).toBe("xhigh");
  });

  test("prefers structured child errors over stderr", () => {
    // Arrange
    const state = createChildAgentEventState();
    state.errorMessage = "Provider failed.";
    state.stopReason = "error";
    const request = runRequest("reviewer", "Review diff");

    // Act
    const result = buildAgentRunResult(request, state, 0, "stderr fallback");

    // Assert
    expect(result.status).toBe("failed");
    expect(result.ok).toBe(false);
    expect(result.finalOutput).toBe("Provider failed.");
    expect(result.stderr).toBe("stderr fallback");
    expect(result.errorMessage).toBe("Provider failed.");
  });

  test("uses stderr when the child exits without assistant output", () => {
    // Arrange
    const state = createChildAgentEventState();
    const request = runRequest("reviewer", "Review diff");

    // Act
    const result = buildAgentRunResult(request, state, 1, "spawn failed\n");

    // Assert
    expect(result.status).toBe("failed");
    expect(result.ok).toBe(false);
    expect(result.finalOutput).toBe("spawn failed");
    expect(result.exitCode).toBe(1);
  });
});

function runRequest(agentName: string, task: string): AgentRunRequest {
  return {
    agent: agentDefinition(agentName),
    task,
    description: "Review task",
    context: "fresh",
    cwd: "/repo",
  };
}

function agentDefinition(name: string): AgentDefinition {
  return {
    name,
    description: `${name} description`,
    systemPrompt: `${name} prompt`,
    filePath: `/agents/${name}.md`,
    source: "user",
    frontmatter: { name, description: `${name} description` },
  };
}
