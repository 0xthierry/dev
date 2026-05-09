import { afterEach, describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { registerAgentsHandlers } from "./register";
import type { AgentsRuntime } from "./runtime";
import type { AgentsContextDiscovery, AgentsContextFile, AgentsSession } from "./types";

function contextFile(overrides: Partial<AgentsContextFile>): AgentsContextFile {
  return {
    key: overrides.key ?? overrides.path ?? "/repo/AGENTS.md",
    path: overrides.path ?? "/repo/AGENTS.md",
    relativePath: overrides.relativePath ?? "AGENTS.md",
    filename: overrides.filename ?? "AGENTS.md",
    content: overrides.content ?? "Follow repo rules.",
  };
}

function agentsSession(overrides: Partial<AgentsSession> = {}): AgentsSession {
  return {
    projectRoot: overrides.projectRoot ?? "/repo",
    nativeFiles: overrides.nativeFiles ?? [],
    diagnostics: overrides.diagnostics ?? [],
  };
}

function runtimeWithDiscovery(session: AgentsSession, discovery: AgentsContextDiscovery): AgentsRuntime {
  return {
    createSession: mock(async () => session),
    discoverForTarget: mock(async () => discovery),
  };
}

afterEach(() => {
  mock.clearAllMocks();
});

describe("registerAgentsHandlers", () => {
  test("does not add a startup system prompt catalog", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo" });
    const runtime = runtimeWithDiscovery(agentsSession(), { files: [], diagnostics: [] });
    registerAgentsHandlers(fake.pi, runtime);

    // Act
    const results = await fake.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "hello",
      systemPrompt: "base",
    });

    // Assert
    expect(results).toEqual([]);
  });

  test("injects newly applicable nested context and skips native startup context", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo" });
    const root = contextFile({ key: "/repo/AGENTS.md", path: "/repo/AGENTS.md", relativePath: "AGENTS.md" });
    const nested = contextFile({
      key: "/repo/tests/AGENTS.md",
      path: "/repo/tests/AGENTS.md",
      relativePath: "tests/AGENTS.md",
      content: "Use test helpers.",
    });
    const runtime = runtimeWithDiscovery(agentsSession({ nativeFiles: [root] }), {
      files: [root, nested],
      diagnostics: [],
    });
    registerAgentsHandlers(fake.pi, runtime);

    // Act
    await fake.emit("tool_call", {
      type: "tool_call",
      toolName: "read",
      toolCallId: "read-1",
      input: { path: "tests/foo.test.ts" },
    });

    // Assert
    expect(runtime.discoverForTarget).toHaveBeenCalledWith(expect.any(Object), "/repo", {
      path: "tests/foo.test.ts",
      kind: "file",
    });
    expect(fake.sentMessages).toHaveLength(1);
    expect(JSON.stringify(fake.sentMessages[0])).toContain("tests/AGENTS.md");
    expect(JSON.stringify(fake.sentMessages[0])).toContain("Use test helpers.");
    expect(JSON.stringify(fake.sentMessages[0])).not.toContain("Follow repo rules.");
  });

  test("does not inject the same context file twice", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo" });
    const nested = contextFile({
      key: "/repo/tests/AGENTS.md",
      path: "/repo/tests/AGENTS.md",
      relativePath: "tests/AGENTS.md",
    });
    const runtime = runtimeWithDiscovery(agentsSession(), { files: [nested], diagnostics: [] });
    registerAgentsHandlers(fake.pi, runtime);

    // Act
    await fake.emit("tool_call", {
      type: "tool_call",
      toolName: "read",
      toolCallId: "read-1",
      input: { path: "tests/a.ts" },
    });
    await fake.emit("tool_call", {
      type: "tool_call",
      toolName: "read",
      toolCallId: "read-2",
      input: { path: "tests/b.ts" },
    });

    // Assert
    expect(fake.sentMessages).toHaveLength(1);
  });

  test("re-injects active nested context after compaction", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo" });
    const nested = contextFile({
      key: "/repo/tests/AGENTS.md",
      path: "/repo/tests/AGENTS.md",
      relativePath: "tests/AGENTS.md",
      content: "Use test helpers.",
    });
    const runtime = runtimeWithDiscovery(agentsSession(), { files: [nested], diagnostics: [] });
    registerAgentsHandlers(fake.pi, runtime);

    // Act
    await fake.emit("tool_call", {
      type: "tool_call",
      toolName: "read",
      toolCallId: "read-1",
      input: { path: "tests/a.ts" },
    });
    await fake.emit("session_compact");
    const [result] = await fake.emit("before_agent_start", {
      type: "before_agent_start",
      prompt: "continue",
      systemPrompt: "base",
    });

    // Assert
    expect(JSON.stringify((result as { message?: unknown }).message)).toContain("tests/AGENTS.md");
    expect(JSON.stringify((result as { message?: unknown }).message)).toContain("Use test helpers.");
  });

  test("orders delivered nested context by stable project scope", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo" });
    const parent = contextFile({
      key: "/repo/tests/AGENTS.md",
      path: "/repo/tests/AGENTS.md",
      relativePath: "tests/AGENTS.md",
      content: "Use test helpers.",
    });
    const child = contextFile({
      key: "/repo/tests/unit/CLAUDE.md",
      path: "/repo/tests/unit/CLAUDE.md",
      relativePath: "tests/unit/CLAUDE.md",
      filename: "CLAUDE.md",
      content: "Prefer unit fixtures.",
    });
    const runtime = runtimeWithDiscovery(agentsSession(), { files: [child, parent], diagnostics: [] });
    registerAgentsHandlers(fake.pi, runtime);

    // Act
    await fake.emit("tool_call", {
      type: "tool_call",
      toolName: "read",
      toolCallId: "read-1",
      input: { path: "tests/unit/a.ts" },
    });

    // Assert
    const message = fake.sentMessages[0]?.message as { content?: string; details?: { files?: string[] } };
    const content = message.content ?? "";
    expect(message.details?.files).toEqual(["tests/AGENTS.md", "tests/unit/CLAUDE.md"]);
    expect(content.indexOf("Use test helpers.")).toBeLessThan(content.indexOf("Prefer unit fixtures."));
  });

  test("notifies UI about loaded context and discovery diagnostics", async () => {
    // Arrange
    const fake = createFakePi({ cwd: "/repo" });
    const nested = contextFile({
      key: "/repo/tests/AGENTS.md",
      path: "/repo/tests/AGENTS.md",
      relativePath: "tests/AGENTS.md",
    });
    const runtime = runtimeWithDiscovery(agentsSession({ diagnostics: ["startup warning"] }), {
      files: [nested],
      diagnostics: ["target warning"],
    });
    registerAgentsHandlers(fake.pi, runtime);

    // Act
    await fake.emit("session_start", { type: "session_start", reason: "startup" }, { hasUI: true });
    await fake.emit(
      "tool_call",
      { type: "tool_call", toolName: "read", toolCallId: "read-1", input: { path: "tests/a.ts" } },
      { hasUI: true },
    );

    // Assert
    expect(fake.uiNotifications).toEqual([
      { message: "startup warning", type: "warning" },
      { message: "target warning", type: "warning" },
      { message: "Loaded nested agent context: tests/AGENTS.md", type: "info" },
    ]);
  });
});
