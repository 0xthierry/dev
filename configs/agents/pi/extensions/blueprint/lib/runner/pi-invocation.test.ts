import { describe, expect, test } from "bun:test";
import {
  BLUEPRINT_DEPTH_ENV,
  buildPiNodeInvocation,
  childEnvironment,
  shouldRegisterBlueprintInCurrentProcess,
} from "./pi-invocation";

describe("buildPiNodeInvocation", () => {
  test("builds a child Pi invocation with inherited model and node tools", () => {
    // Arrange
    const request = {
      node: {
        type: "pi" as const,
        prompt: "Implement",
        model: "inherit",
        thinking: "high" as const,
        tools: ["read", "bash"],
        skills: ["/repo/.pi/skills/research/SKILL.md"],
      },
      contextFile: "/runs/context.md",
      prompt: "Task: implement",
      systemPromptFile: "/runs/system.md",
      sessionsDir: "/runs/sessions",
      parentModelRef: "anthropic/claude-sonnet",
      parentThinking: "medium" as const,
    };

    // Act
    const invocation = buildPiNodeInvocation(request);

    // Assert
    expect(invocation.args).toContain("--session-dir");
    expect(invocation.args).toContain("/runs/sessions");
    expect(invocation.args).toContain("--append-system-prompt");
    expect(invocation.args).toContain("--model");
    expect(invocation.args).toContain("anthropic/claude-sonnet");
    expect(invocation.args).toContain("--thinking");
    expect(invocation.args).toContain("high");
    expect(invocation.args).toContain("--tools");
    expect(invocation.args).toContain("read,bash");
    expect(invocation.args).toContain("--skill");
    expect(invocation.args).toContain("/repo/.pi/skills/research/SKILL.md");
    expect(invocation.args.at(-1)).toBe("Task: implement");
    expect(invocation.env[BLUEPRINT_DEPTH_ENV]).toBe("1");
  });
});

describe("blueprint child environment", () => {
  test("increments child depth and disables command registration in children", () => {
    // Arrange
    const env = { [BLUEPRINT_DEPTH_ENV]: "2" };

    // Act
    const child = childEnvironment(env);

    // Assert
    expect(child[BLUEPRINT_DEPTH_ENV]).toBe("3");
    expect(shouldRegisterBlueprintInCurrentProcess({ [BLUEPRINT_DEPTH_ENV]: "1" })).toBe(false);
    expect(shouldRegisterBlueprintInCurrentProcess({})).toBe(true);
  });
});
