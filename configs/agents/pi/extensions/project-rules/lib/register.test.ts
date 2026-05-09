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
    discover: mock(async () => ({ projectRoot: "/repo", rules, diagnostics: [] })),
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
    expect(fake.handlers.has("session_compact")).toBe(true);
    expect(fake.handlers.has("before_agent_start")).toBe(true);
    expect(fake.handlers.has("tool_call")).toBe(true);
    expect(fake.handlers.has("tool_result")).toBe(true);
    expect(fake.handlers.has("turn_end")).toBe(true);
    expect(fake.handlers.has("agent_end")).toBe(true);
    expect(fake.commands.has("rules")).toBe(true);
  });

  test("keeps always rule bodies in the stable system prompt instead of a prompt-suffix message", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo" });
    const runtime = runtimeWithRules([
      rule({ key: "testing", relativePath: ".pi/rules/testing.md", content: "Run tests." }),
    ]);
    registerProjectRulesHandlers(fake.pi, runtime);

    // Act
    const [result] = await fake.emit("before_agent_start", { prompt: "hello", systemPrompt: "base" });

    // Assert
    const systemPrompt = String((result as { systemPrompt: string }).systemPrompt);
    expect(systemPrompt).toContain("## Available Project Rules");
    expect((result as { message?: unknown }).message).toBeUndefined();
    expect(systemPrompt).toContain("## Always Project Rules");
    expect(systemPrompt).toContain("Run tests.");
  });

  test("sends stable rule content before dynamic reason when a tool path activates a path rule", async () => {
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
    const content = String((fake.sentMessages[0]?.message as { content?: string }).content);
    expect(content).toContain("Validate API input.");
    expect(content.indexOf("Validate API input.")).toBeLessThan(content.indexOf("Activation reason:"));
    expect(fake.sentMessages[0]?.message).toMatchObject({ display: false });
    expect(fake.sentMessages[0]?.options).toEqual({ deliverAs: "steer" });
  });

  test("matches cwd-relative tool paths against project-root-relative rule patterns", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo/packages/app" });
    const runtime: ProjectRulesRuntime = {
      discover: mock(async () => ({
        projectRoot: "/repo",
        diagnostics: [],
        rules: [
          rule({
            key: "app",
            relativePath: "packages/app/.pi/rules/app.md",
            content: "Use app conventions.",
            mode: "path",
            patterns: ["packages/app/src/**/*.ts"],
          }),
        ],
      })),
    };
    registerProjectRulesHandlers(fake.pi, runtime);

    // Act
    await fake.emit("tool_call", { toolName: "read", input: { path: "src/users.ts" } });

    // Assert
    expect(JSON.stringify(fake.sentMessages[0]?.message)).toContain("Use app conventions.");
  });

  test("matches cwd-relative prompt paths against project-root-relative rule patterns", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo/packages/app" });
    const runtime: ProjectRulesRuntime = {
      discover: mock(async () => ({
        projectRoot: "/repo",
        diagnostics: [],
        rules: [
          rule({
            key: "app",
            relativePath: "packages/app/.pi/rules/app.md",
            content: "Use app conventions.",
            mode: "path",
            patterns: ["packages/app/src/**/*.ts"],
          }),
        ],
      })),
    };
    registerProjectRulesHandlers(fake.pi, runtime);

    // Act
    const [result] = await fake.emit("before_agent_start", {
      prompt: "Edit src/users.ts",
      systemPrompt: "base",
    });

    // Assert
    expect(JSON.stringify((result as { message?: unknown }).message)).toContain("Use app conventions.");
  });

  test("does not re-inject a rule body on the next turn after a tool activation", async () => {
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
    const [result] = await fake.emit("before_agent_start", { prompt: "continue", systemPrompt: "base" });

    // Assert
    expect(fake.sentMessages).toHaveLength(1);
    expect((result as { message?: unknown }).message).toBeUndefined();
    expect((result as { systemPrompt?: string }).systemPrompt).toContain("## Available Project Rules");
  });

  test("re-injects delivered path rules after compaction clears delivered rule context", async () => {
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
    await fake.emit("before_agent_start", { prompt: "Edit src/api/users.ts", systemPrompt: "base" });
    await fake.emit("session_compact");
    const [result] = await fake.emit("before_agent_start", { prompt: "continue", systemPrompt: "base" });

    // Assert
    expect(JSON.stringify((result as { message?: unknown }).message)).toContain("Validate API input.");
  });

  test("recovers from a failed discovery on a later load", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo" });
    let calls = 0;
    const runtime: ProjectRulesRuntime = {
      discover: mock(async () => {
        calls += 1;
        if (calls === 1) throw new Error("discovery failed");
        return {
          projectRoot: "/repo",
          diagnostics: [],
          rules: [rule({ key: "testing", relativePath: ".pi/rules/testing.md", content: "Run tests." })],
        };
      }),
    };
    registerProjectRulesHandlers(fake.pi, runtime);

    // Act / Assert
    await expect(fake.emit("session_start")).rejects.toThrow("discovery failed");
    const [result] = await fake.emit("before_agent_start", { prompt: "hello", systemPrompt: "base" });
    expect(String((result as { systemPrompt?: string }).systemPrompt)).toContain("Run tests.");
  });

  test("marks a rule active when the read tool opens the rule file", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo" });
    const runtime = runtimeWithRules([rule({ key: "api", relativePath: ".pi/rules/api.md", mode: "agent" })]);
    registerProjectRulesHandlers(fake.pi, runtime);

    // Act
    await fake.emit("tool_call", { toolCallId: "read-rule", toolName: "read", input: { path: ".pi/rules/api.md" } });
    await fake.emit("tool_result", {
      toolCallId: "read-rule",
      toolName: "read",
      input: { path: ".pi/rules/api.md" },
      content: [{ type: "text", text: "Rule body" }],
      isError: false,
    });
    await fake.runCommand("rules");

    // Assert
    expect(JSON.stringify(fake.sentMessages[0]?.message)).toContain(".pi/rules/api.md (agent, active)");
  });

  test("injects rule context on a later turn if a direct rule-file read result is lost", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo" });
    const runtime = runtimeWithRules([
      rule({ key: "api", relativePath: ".pi/rules/api.md", mode: "agent", content: "Use API rules." }),
    ]);
    registerProjectRulesHandlers(fake.pi, runtime);

    // Act
    await fake.emit("tool_call", { toolCallId: "read-rule", toolName: "read", input: { path: ".pi/rules/api.md" } });
    const [result] = await fake.emit("before_agent_start", { prompt: "continue", systemPrompt: "base" });

    // Assert
    expect(JSON.stringify((result as { message?: unknown }).message)).toContain("Use API rules.");
  });

  test("does not inject duplicate context when a parallel direct rule-file read succeeds", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo" });
    const runtime = runtimeWithRules([
      rule({ key: "api", relativePath: ".pi/rules/api.md", mode: "agent", content: "Use API rules." }),
    ]);
    registerProjectRulesHandlers(fake.pi, runtime);

    // Act
    await fake.emit("tool_call", { toolCallId: "read-rule-1", toolName: "read", input: { path: ".pi/rules/api.md" } });
    await fake.emit("tool_call", { toolCallId: "read-rule-2", toolName: "read", input: { path: ".pi/rules/api.md" } });
    await fake.emit("tool_result", {
      toolCallId: "read-rule-2",
      toolName: "read",
      input: { path: ".pi/rules/api.md" },
      content: [{ type: "text", text: "Use API rules." }],
      isError: false,
    });
    await fake.emit("tool_result", {
      toolCallId: "read-rule-1",
      toolName: "read",
      input: { path: ".pi/rules/api.md" },
      content: [{ type: "text", text: "Could not read" }],
      isError: true,
    });

    // Assert
    expect(fake.sentMessages).toHaveLength(0);
  });

  test("injects rule context if a direct rule-file read activation fails", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo" });
    const runtime = runtimeWithRules([
      rule({ key: "api", relativePath: ".pi/rules/api.md", mode: "agent", content: "Use API rules." }),
    ]);
    registerProjectRulesHandlers(fake.pi, runtime);

    // Act
    await fake.emit("tool_call", { toolCallId: "read-rule", toolName: "read", input: { path: ".pi/rules/api.md" } });
    expect(fake.sentMessages).toHaveLength(0);
    await fake.emit("tool_result", {
      toolCallId: "read-rule",
      toolName: "read",
      input: { path: ".pi/rules/api.md" },
      content: [{ type: "text", text: "Could not read" }],
      isError: true,
    });

    // Assert
    expect(JSON.stringify(fake.sentMessages[0]?.message)).toContain("Use API rules.");
  });

  test("shows activation notices through UI notifications instead of LLM messages", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo" });
    const runtime = runtimeWithRules([
      rule({ key: "testing", relativePath: ".pi/rules/testing.md", content: "Run tests." }),
    ]);
    registerProjectRulesHandlers(fake.pi, runtime);

    // Act
    await fake.emit("before_agent_start", { prompt: "hello", systemPrompt: "base" }, { hasUI: true });

    // Assert
    expect(fake.uiNotifications).toContainEqual({
      message: "Activated project rule(s):\n- .pi/rules/testing.md — always",
      type: "info",
    });
  });

  test("shows /rules output through the UI when available", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo" });
    const runtime = runtimeWithRules([rule({ key: "api", relativePath: ".pi/rules/api.md", mode: "agent" })]);
    registerProjectRulesHandlers(fake.pi, runtime);

    // Act
    await fake.runCommand("rules", "", { hasUI: true });

    // Assert
    expect(fake.sentMessages).toHaveLength(0);
    expect(fake.uiNotifications[0]?.message).toContain(".pi/rules/api.md (agent, inactive)");
  });
});
