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
    state.sessionId = "019e1882-8bc8-767c-a1e6-d7c9ebd3a574";
    state.usage.input = 10;
    const request = runRequest("reviewer", "Review diff");

    // Act
    const result = buildAgentRunResult(
      request,
      state,
      0,
      "",
      "/agent-sessions/session.jsonl",
      "/agent-artifacts/output.md",
      undefined,
      {
        inputPath: "/agent-artifacts/input.md",
        outputPath: "/agent-artifacts/output.md",
        jsonlPath: "/agent-artifacts/run.jsonl",
        metadataPath: "/agent-artifacts/meta.json",
      },
    );

    // Assert
    expect(result).toMatchObject({
      agent: "reviewer",
      task: "Review diff",
      context: "fresh",
      status: "succeeded",
      ok: true,
      exitCode: 0,
      finalOutput: "Agent completed.\n\nDetailed subagent output saved to: /agent-artifacts/output.md",
      agentId: "019e1882-8bc8-767c-a1e6-d7c9ebd3a574",
      sessionFile: "/agent-sessions/session.jsonl",
      outputArtifactPath: "/agent-artifacts/output.md",
      artifactPaths: {
        inputPath: "/agent-artifacts/input.md",
        outputPath: "/agent-artifacts/output.md",
        jsonlPath: "/agent-artifacts/run.jsonl",
        metadataPath: "/agent-artifacts/meta.json",
      },
      model: "test-model",
      thinking: undefined,
      stopReason: "stop",
    });
    expect(result.usage.input).toBe(10);
    expect(result.activity).toEqual([]);
  });

  test("uses the requested resume session id and file when the child header is unavailable", () => {
    // Arrange
    const state = createChildAgentEventState();
    state.finalOutput = "Agent completed.";
    state.stopReason = "stop";
    const request = {
      ...runRequest("reviewer", "Continue review"),
      context: "resume" as const,
      resumeAgentId: "019e1882",
      resumeSessionFile: "/agent-sessions/session.jsonl",
    };

    // Act
    const result = buildAgentRunResult(request, state, 0, "");

    // Assert
    expect(result.agentId).toBe("019e1882");
    expect(result.sessionFile).toBe("/agent-sessions/session.jsonl");
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

  test("treats late child errors after assistant output as a successful result", () => {
    // Arrange
    const state = createChildAgentEventState();
    state.finalOutput = "## Findings\nSecurity review completed.";
    state.errorMessage = "WebSocket error";
    state.stopReason = "error";
    const request = runRequest("reviewer", "Review diff");

    // Act
    const result = buildAgentRunResult(request, state, 1, "Error: WebSocket error");

    // Assert
    expect(result.status).toBe("succeeded");
    expect(result.ok).toBe(true);
    expect(result.finalOutput).toBe("## Findings\nSecurity review completed.");
    expect(result.errorMessage).toBe("WebSocket error");
  });

  test("prefers structured child errors over stderr when no assistant output exists", () => {
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

  test("records artifact write failures without losing child output", () => {
    // Arrange
    const state = createChildAgentEventState();
    state.finalOutput = "Agent completed.";
    const request = runRequest("reviewer", "Review diff");

    // Act
    const result = buildAgentRunResult(request, state, 0, "", undefined, undefined, "EACCES");

    // Assert
    expect(result.status).toBe("succeeded");
    expect(result.finalOutput).toBe("Agent completed.\n\nDetailed subagent output artifact could not be saved: EACCES");
    expect(result.outputArtifactError).toBe("EACCES");
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
    agentSessionDir: "/agent-sessions/--repo--",
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
