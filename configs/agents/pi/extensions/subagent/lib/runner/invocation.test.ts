import { describe, expect, test } from "bun:test";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AgentDefinition } from "../agents/types";
import {
  buildAgentRunRequest,
  buildChildInvocation,
  CHILD_DEPTH_ENV,
  CHILD_EXTENSIONS_ENV,
  CHILD_NO_EXTENSIONS_ENV,
  CHILD_UNSET_ENV,
  childEnvironment,
  shouldRegisterInCurrentProcess,
} from "./invocation";

describe("buildAgentRunRequest", () => {
  test("inherits cwd, saved session, model, and thinking from the parent context", () => {
    // Arrange
    const ctx = {
      cwd: "/repo",
      model: { provider: "anthropic", id: "claude-sonnet" },
      sessionManager: { getSessionFile: () => "/sessions/parent.jsonl" },
    } as unknown as ExtensionContext;

    // Act
    const request = buildAgentRunRequest(
      ctx,
      { agent: agent("reviewer"), task: "Review", context: "fork", description: "Review diff" },
      "high",
    );

    // Assert
    expect(request).toMatchObject({
      cwd: "/repo",
      parentSessionFile: "/sessions/parent.jsonl",
      modelRef: "anthropic/claude-sonnet",
      thinking: "high",
      task: "Review",
      description: "Review diff",
      context: "fork",
    });
  });
});

describe("buildChildInvocation", () => {
  test("builds a fresh child Pi invocation", () => {
    // Arrange
    process.env[CHILD_NO_EXTENSIONS_ENV] = "1";
    process.env[CHILD_EXTENSIONS_ENV] = "configs/agents/pi/extensions/_shared/testing/faux-provider-extension.ts";
    const request = {
      agent: agent("reviewer"),
      task: "Review diff",
      context: "fresh" as const,
      cwd: "/repo",
      modelRef: "openai/gpt-5.5",
      thinking: "medium" as const,
    };

    try {
      // Act
      const invocation = buildChildInvocation(request, "/tmp/prompt.md");

      // Assert
      expect(invocation.args).toContain("--no-session");
      expect(invocation.args).toContain("--no-extensions");
      expect(invocation.args).toContain("-e");
      expect(invocation.args).toContain("--model");
      expect(invocation.args).toContain("openai/gpt-5.5");
      expect(invocation.args).toContain("--thinking");
      expect(invocation.args.at(-1)).toBe("Task: Review diff");
      expect(invocation.env[CHILD_DEPTH_ENV]).toBe("1");
    } finally {
      delete process.env[CHILD_NO_EXTENSIONS_ENV];
      delete process.env[CHILD_EXTENSIONS_ENV];
    }
  });

  test("builds a forked child Pi invocation when a parent session exists", () => {
    // Arrange
    const request = {
      agent: agent("reviewer"),
      task: "Review diff",
      context: "fork" as const,
      cwd: "/repo",
      parentSessionFile: "/sessions/parent.jsonl",
    };

    // Act
    const invocation = buildChildInvocation(request, "/tmp/prompt.md");

    // Assert
    expect(invocation.args).toContain("--fork");
    expect(invocation.args).toContain("/sessions/parent.jsonl");
    expect(invocation.args).not.toContain("--no-session");
  });

  test("rejects forked context without a saved parent session", () => {
    // Arrange
    const request = { agent: agent("reviewer"), task: "Review diff", context: "fork" as const, cwd: "/repo" };

    // Act / Assert
    expect(() => buildChildInvocation(request, "/tmp/prompt.md")).toThrow("requires a saved parent Pi session");
  });
});

describe("childEnvironment", () => {
  test("increments child depth and removes requested parent-only environment variables", () => {
    // Arrange
    const env = {
      [CHILD_DEPTH_ENV]: "2",
      [CHILD_UNSET_ENV]: "SECRET_ONE, SECRET_TWO",
      SECRET_ONE: "x",
      SECRET_TWO: "y",
    };

    // Act
    const child = childEnvironment(env);

    // Assert
    expect(child[CHILD_DEPTH_ENV]).toBe("3");
    expect(child.SECRET_ONE).toBeUndefined();
    expect(child.SECRET_TWO).toBeUndefined();
  });
});

describe("shouldRegisterInCurrentProcess", () => {
  test("returns false inside a child subagent process", () => {
    // Arrange
    const env = { [CHILD_DEPTH_ENV]: "1" };

    // Act
    const result = shouldRegisterInCurrentProcess(env);

    // Assert
    expect(result).toBe(false);
  });
});

function agent(name: string): AgentDefinition {
  return {
    name,
    description: `${name} description`,
    systemPrompt: `${name} prompt`,
    filePath: `/agents/${name}.md`,
    source: "user",
    frontmatter: { name, description: `${name} description` },
  };
}
