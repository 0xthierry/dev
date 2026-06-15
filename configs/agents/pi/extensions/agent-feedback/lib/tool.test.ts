import { afterEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createFakePi } from "../../_shared/testing/fake-pi";
import type { AgentFeedbackRuntime } from "./runtime";
import {
  AGENT_FEEDBACK_TOOL_NAME,
  type AgentFeedbackToolDetails,
  executeAgentFeedbackTool,
  registerAgentFeedbackTool,
} from "./tool";

type ToolResult = AgentToolResult<AgentFeedbackToolDetails>;

afterEach(() => {
  setSystemTime();
});

describe("registerAgentFeedbackTool", () => {
  test("registers the agent_feedback tool with guidance", () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = fakeRuntime();

    // Act
    registerAgentFeedbackTool(fakePi.pi, runtime);

    // Assert
    const tool = fakePi.tools.get(AGENT_FEEDBACK_TOOL_NAME);
    expect(tool?.description).toContain("verification blockers");
    expect(tool?.description).toContain("current working directory");
    expect(tool?.promptGuidelines).toContain(
      "agent_feedback: Never include secrets, tokens, raw credential values, private keys, raw environment dumps, or sensitive user data; describe config names generically instead.",
    );
    expect(fakePi.tools.has(AGENT_FEEDBACK_TOOL_NAME)).toBe(true);
  });

  test("writes structured feedback through the provided runtime", async () => {
    // Arrange
    setSystemTime(new Date(2026, 4, 11, 9, 7, 30));
    const fakePi = createFakePi({ cwd: "/repo" });
    const runtime = fakeRuntime();
    registerAgentFeedbackTool(fakePi.pi, runtime);

    // Act
    const result = (await fakePi.runTool(AGENT_FEEDBACK_TOOL_NAME, {
      category: "verification_blocker",
      summary: "Could not run smoke tests.",
      impact: "Release verification remained incomplete.",
      attempted: "Ran bun test and the Docker smoke test command.",
      blocker: "Docker daemon was unavailable.",
      suggestedFix: "Document the Docker requirement or provide a remote smoke target.",
    })) as ToolResult;

    // Assert
    expect(runtime.buildPath).toHaveBeenCalledWith("/repo");
    expect(runtime.appendEntry).toHaveBeenCalledWith({
      filePath: "/feedback/repo/agent_feedback.md",
      entry: expect.stringContaining("## 2026-05-11 09:07 — verification_blocker"),
    });
    expect(firstText(result)).toBe("Saved agent feedback to agent_feedback.md (2026-05-11 09:07).");
    expect(result.details).toMatchObject({
      ok: true,
      path: "agent_feedback.md",
      category: "verification_blocker",
      timestamp: "2026-05-11 09:07",
    });
  });
});

describe("executeAgentFeedbackTool", () => {
  test("returns a validation error without writing invalid feedback", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/repo" });
    const runtime = fakeRuntime();

    // Act
    const result = (await executeAgentFeedbackTool(
      runtime,
      { category: "verification_blocker", summary: "", impact: "could not verify" },
      undefined,
      fakePi.createContext() as unknown as ExtensionContext,
    )) as ToolResult;

    // Assert
    expect(firstText(result)).toBe("agent_feedback failed: agent_feedback.summary must be a non-empty string.");
    expect(result.details).toMatchObject({ ok: false, error: { code: "EMPTY_SUMMARY" } });
    expect(runtime.appendEntry).not.toHaveBeenCalled();
  });

  test("returns an aborted result without writing", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/repo" });
    const runtime = fakeRuntime();
    const controller = new AbortController();
    controller.abort();

    // Act
    const result = (await executeAgentFeedbackTool(
      runtime,
      { category: "environment_gap", summary: "Missing service", impact: "Could not verify." },
      controller.signal,
      fakePi.createContext() as unknown as ExtensionContext,
    )) as ToolResult;

    // Assert
    expect(result.details).toMatchObject({ ok: false, error: { code: "ABORTED" } });
    expect(runtime.appendEntry).not.toHaveBeenCalled();
  });

  test("returns a write failure when storage fails", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/repo" });
    const runtime = fakeRuntime();
    runtime.appendEntry = mock(async () => {
      throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    });

    // Act
    const result = (await executeAgentFeedbackTool(
      runtime,
      { category: "environment_gap", summary: "Missing service", impact: "Could not verify." },
      undefined,
      fakePi.createContext() as unknown as ExtensionContext,
    )) as ToolResult;

    // Assert
    expect(firstText(result)).toBe("agent_feedback failed: Could not write agent feedback: EACCES.");
    expect(result.details).toMatchObject({ ok: false, error: { code: "WRITE_FAILED" } });
  });
});

function firstText(result: ToolResult): string | undefined {
  const item = result.content[0];
  return item?.type === "text" ? item.text : undefined;
}

function fakeRuntime(): AgentFeedbackRuntime {
  return {
    buildPath: mock(() => ({
      filePath: "/feedback/repo/agent_feedback.md",
      displayPath: "agent_feedback.md",
    })),
    appendEntry: mock(async () => undefined),
  };
}
