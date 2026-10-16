import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePi } from "../_shared/testing/fake-pi";

// The intentionally single-file vendor module remains outside the repository TS project.
const extensionPath = "../ai-memory-pi.ts";
const { default: register } = await import(extensionPath);
const originalFetch = globalThis.fetch;
const originalDataDir = process.env.AI_MEMORY_DATA_DIR;
const originalRunId = process.env.AI_MEMORY_RUN_ID;
let root: string;
let requests: Array<{ url: URL; body: Record<string, unknown> }>;
let sessionEnded: Promise<void>;
let endSession: () => void;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ai-memory-native-"));
  process.env.AI_MEMORY_DATA_DIR = join(root, "data");
  delete process.env.AI_MEMORY_RUN_ID;
  mkdirSync(join(root, "data"));
  requests = [];
  sessionEnded = new Promise((resolve) => {
    endSession = resolve;
  });
  globalThis.fetch = Object.assign(
    mock(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = new URL(String(input));
      const body = JSON.parse(String(init?.body ?? "{}"));
      requests.push({ url, body });
      if (url.searchParams.get("event") === "session-end") endSession();
      return new Response(url.pathname === "/handoff" ? "Prior session context" : "ok");
    }),
    { preconnect: originalFetch.preconnect },
  );
});

afterEach(async () => {
  await sessionEnded;
  globalThis.fetch = originalFetch;
  process.env.AI_MEMORY_DATA_DIR = originalDataDir;
  process.env.AI_MEMORY_RUN_ID = originalRunId;
  rmSync(root, { recursive: true, force: true });
});

function fixture() {
  return createFakePi({
    cwd: root,
    ctx: { sessionManager: { getSessionId: () => root }, model: { id: "fixture-model" } },
  });
}

test("hooks preserve capture, handoff and explicit-scope guidance without registering tools", async () => {
  // Arrange
  writeFileSync(join(root, ".ai-memory.toml"), 'workspace = "fixture"\nproject = "native"\n');
  const fake = fixture();
  register(fake.pi);

  // Act
  await fake.emit("session_start");
  const context = await fake.emit("before_agent_start", {
    systemPrompt: "Base prompt",
    prompt: "Remember this",
    images: [],
  });
  await fake.emit("tool_call", {
    toolName: "mcp__ai_memory__memory_status",
    toolCallId: "call-1",
    input: { workspace: "fixture", project: "native" },
  });
  await fake.emit("tool_result", {
    toolName: "mcp__ai_memory__memory_status",
    toolCallId: "call-1",
    input: { workspace: "fixture", project: "native" },
    content: [{ text: "status" }],
  });
  await fake.emit("session_before_compact");
  await fake.emit("session_compact");
  await fake.emit("agent_end");
  await fake.emit("session_shutdown");
  await sessionEnded;

  // Assert
  expect([...fake.tools.keys()]).toEqual([]);
  expect(requests.filter(({ url }) => url.pathname === "/mcp")).toEqual([]);
  expect(context[0]).toEqual({
    systemPrompt: expect.stringMatching(/^Base prompt\n\n.*pass both workspace and project explicitly/),
  });
  expect(context[1]).toEqual({
    message: {
      customType: "ai-memory-handoff",
      content: "Prior session context",
      display: false,
      attribution: "agent",
    },
  });
  expect(
    requests
      .filter(({ url }) => url.pathname === "/hook")
      .map(({ url, body }) => ({
        event: url.searchParams.get("event"),
        workspace: url.searchParams.get("workspace"),
        project: url.searchParams.get("project"),
        cwd: body.cwd,
        sessionID: body.sessionID,
      })),
  ).toEqual(
    ["session-start", "user-prompt", "pre-tool-use", "post-tool-use", "pre-compact", "stop", "session-end"].map(
      (event) => ({ event, workspace: "fixture", project: "native", cwd: root, sessionID: root }),
    ),
  );
  expect(requests.find(({ url }) => url.searchParams.get("event") === "post-tool-use")?.body).toEqual({
    sessionID: root,
    cwd: root,
    model: "fixture-model",
    tool: "mcp__ai_memory__memory_status",
    callID: "call-1",
    args: { workspace: "fixture", project: "native" },
    output: "status",
  });
  expect(requests.find(({ url }) => url.pathname === "/handoff")?.url.searchParams.get("session_id")).toBe(root);
});

test("capture ignore policy still drops ignored file events without dropping native memory events", async () => {
  // Arrange
  writeFileSync(join(root, ".ai-memory.toml"), '[capture]\nignore_paths = ["secrets/**"]\n');
  const fake = fixture();
  register(fake.pi);

  // Act
  await fake.emit("session_start");
  await fake.emit("tool_call", { toolName: "read", input: { path: "secrets/key" } });
  await fake.emit("tool_call", {
    toolName: "mcp__ai_memory__memory_status",
    input: { workspace: "fixture", project: "native" },
  });
  await fake.emit("session_shutdown");
  await sessionEnded;

  // Assert
  expect(requests.filter(({ url }) => url.pathname === "/hook").map(({ body }) => body.tool)).toEqual([
    undefined,
    "mcp__ai_memory__memory_status",
    undefined,
  ]);
  expect(requests.find(({ body }) => body.tool === "mcp__ai_memory__memory_status")?.body._ai_memory_capture).toEqual({
    version: 1,
    disposition: "keep",
    policy_state: "active",
    tool_family: "unknown",
    path_count: 0,
    extraction_state: "extracted",
  });
});

test("managed runs still inject handoff once and do not double-post session start", async () => {
  // Arrange
  process.env.AI_MEMORY_RUN_ID = "fixture-run";
  const fake = fixture();
  register(fake.pi);

  // Act
  await fake.emit("session_start");
  const first = await fake.emit("before_agent_start", { systemPrompt: "Base", prompt: "First" });
  const second = await fake.emit("before_agent_start", { systemPrompt: "Base", prompt: "Second" });
  await fake.emit("session_shutdown");
  await sessionEnded;

  // Assert
  expect(first[1]).toEqual({
    message: {
      customType: "ai-memory-handoff",
      content: "Prior session context",
      display: false,
      attribution: "agent",
    },
  });
  expect(second[1]).toBeUndefined();
  expect(requests.map(({ url }) => (url.pathname === "/handoff" ? "handoff" : url.searchParams.get("event")))).toEqual([
    "handoff",
    "user-prompt",
    "user-prompt",
    "session-end",
  ]);
  expect(requests.map(({ url }) => url.searchParams.get("managed_run"))).toEqual([
    "fixture-run",
    "fixture-run",
    "fixture-run",
    "fixture-run",
  ]);
});
