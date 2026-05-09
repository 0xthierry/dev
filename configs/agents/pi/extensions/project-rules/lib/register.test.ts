import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { registerProjectRulesHandlers } from "./register";
import type { ProjectRulesRuntime } from "./runtime";
import type { ProjectRule } from "./types";

function rule(overrides: Partial<ProjectRule>): ProjectRule {
  return {
    key: overrides.key ?? "rule",
    path: overrides.path ?? "/repo/.pi/rules/rule.md",
    relativePath: overrides.relativePath ?? ".pi/rules/rule.md",
    aliases: overrides.aliases ?? [overrides.relativePath ?? ".pi/rules/rule.md"],
    source: overrides.source ?? ".pi/rules",
    name: overrides.name ?? "rule",
    content: overrides.content ?? "Rule body",
    frontmatter: overrides.frontmatter ?? { paths: [], globs: [], raw: {}, hasFrontmatter: false },
    mode: overrides.mode ?? "always",
    patterns: overrides.patterns ?? [],
    description: overrides.description,
  };
}

function runtimeWithRules(rules: ProjectRule[]): ProjectRulesRuntime {
  return {
    discover: mock(async () => ({ rules, diagnostics: [] })),
  };
}

describe("registerProjectRulesHandlers", () => {
  test("registers lifecycle handlers and the rules command", () => {
    // Arrange
    const fake = createFakePi();
    const runtime = runtimeWithRules([]);

    // Act
    registerProjectRulesHandlers(fake.pi, runtime);

    // Assert
    expect(fake.handlers.has("session_start")).toBe(true);
    expect(fake.handlers.has("before_agent_start")).toBe(true);
    expect(fake.handlers.has("tool_call")).toBe(true);
    expect(fake.commands.has("rules")).toBe(true);
  });

  test("injects active rules and reports first activation", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo" });
    const runtime = runtimeWithRules([
      rule({ key: "testing", relativePath: ".pi/rules/testing.md", content: "Run tests." }),
    ]);
    registerProjectRulesHandlers(fake.pi, runtime);

    // Act
    const [result] = await fake.emit("before_agent_start", { prompt: "hello", systemPrompt: "base" });

    // Assert
    expect(result).toMatchObject({
      systemPrompt: expect.stringContaining("Run tests."),
      message: {
        customType: "project-rules",
        content: "Activated project rule(s):\n- .pi/rules/testing.md — always",
        display: true,
      },
    });
  });

  test("sends rule content when a tool path activates a path rule", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo" });
    const runtime = runtimeWithRules([
      rule({
        key: "api",
        relativePath: ".pi/rules/api.md",
        content: "Validate API input.",
        mode: "path",
        patterns: ["src/api/**/*.ts"],
      }),
    ]);
    registerProjectRulesHandlers(fake.pi, runtime);

    // Act
    await fake.emit("tool_call", { toolName: "read", input: { path: "src/api/users.ts" } });

    // Assert
    expect(fake.sentMessages).toHaveLength(1);
    expect(JSON.stringify(fake.sentMessages[0]?.message)).toContain("Validate API input.");
    expect(fake.sentMessages[0]?.options).toEqual({ deliverAs: "steer" });
  });

  test("marks a rule active when the read tool opens the rule file", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo" });
    const runtime = runtimeWithRules([rule({ key: "api", relativePath: ".pi/rules/api.md", mode: "agent" })]);
    registerProjectRulesHandlers(fake.pi, runtime);

    // Act
    await fake.emit("tool_call", { toolName: "read", input: { path: ".pi/rules/api.md" } });
    await fake.runCommand("rules");

    // Assert
    expect(JSON.stringify(fake.sentMessages[0]?.message)).toContain(".pi/rules/api.md (agent, active)");
  });
});
