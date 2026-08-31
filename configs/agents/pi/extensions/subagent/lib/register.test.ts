import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import {
  formatRootFinalAnswer,
  hasChildLaunchEnvironment,
  PARENT_ORCHESTRATION_GUIDANCE,
  registerSubagentExtension,
  type SubagentBoundaryRuntime,
} from "./register";
import { createEnvironmentRedactor } from "./security/redaction";
import { createFakeToolsRuntime } from "./tools/test-support";

function boundaryRuntime(): SubagentBoundaryRuntime {
  return {
    ...createFakeToolsRuntime(),
    start: mock(async () => undefined),
    buildParentPrompt: mock(async () => PARENT_ORCHESTRATION_GUIDANCE),
    shutdown: mock(async () => undefined),
  };
}

describe("registerSubagentExtension", () => {
  test("bounds the final root envelope after redacting pathological metadata and output", () => {
    // Arrange
    const redact = createEnvironmentRedactor({ API_KEY: "/" });
    const notification = {
      messageType: "FINAL_ANSWER" as const,
      agentPath: "/root/child",
      agentId: "agent/child",
      parentPath: "/root",
      assignmentId: "agent/child:1",
      generation: 1,
      status: "completed" as const,
      artifactReference: "subagent-artifact:0123456789abcdef0123456789abcdef",
      outputPreview: "\0".repeat(12_302),
      execution: {
        profile: { provider: "faux/provider", model: "faux/model", effort: "off" as const },
        source: { model: "agent" as const, effort: "agent" as const },
      },
    };

    // Act
    const message = formatRootFinalAnswer(notification, redact);

    // Assert
    expect(Buffer.byteLength(message, "utf8")).toBeLessThanOrEqual(16_384);
    expect(message).not.toContain("/root");
    expect(message).toContain("[REDACTED]");
    expect(message).toContain(notification.artifactReference);
  });

  test("registers exactly seven stable tools and lifecycle handlers", () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = boundaryRuntime();

    // Act
    registerSubagentExtension(fakePi.pi, runtime);

    // Assert
    expect([...fakePi.tools.keys()]).toEqual([
      "agent_spawn",
      "agent_send",
      "agent_followup",
      "agent_wait",
      "agent_interrupt",
      "agent_list",
      "agent_close",
    ]);
    expect(fakePi.tools.has("agent")).toBe(false);
    expect([...fakePi.handlers.keys()]).toEqual(["session_start", "before_agent_start", "session_shutdown"]);
  });

  test("owns one active Pi lifecycle and appends only stable parent guidance", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = boundaryRuntime();
    registerSubagentExtension(fakePi.pi, runtime);

    // Act
    await fakePi.emit("session_start", { reason: "startup" });
    const prompts = await fakePi.emit("before_agent_start", { systemPrompt: "base" });
    await fakePi.emit("session_shutdown", { reason: "quit" });

    // Assert
    expect(runtime.start).toHaveBeenCalledTimes(1);
    expect(runtime.supervisor.clearSettledActivities).toHaveBeenCalledTimes(1);
    expect(runtime.shutdown).toHaveBeenCalledTimes(1);
    expect(prompts).toEqual([{ systemPrompt: `base\n\n${PARENT_ORCHESTRATION_GUIDANCE}` }]);
  });

  test("starts lazily before the first agent turn when RPC mode emits no session_start", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = boundaryRuntime();
    registerSubagentExtension(fakePi.pi, runtime);

    // Act
    await fakePi.emit("before_agent_start", { systemPrompt: "base" });

    // Assert
    expect(runtime.start).toHaveBeenCalledTimes(1);
    expect(runtime.buildParentPrompt).toHaveBeenCalledTimes(1);
  });

  test("keeps Codex-audited critical-path and background orchestration clauses stable", () => {
    // Arrange
    const guidance = PARENT_ORCHESTRATION_GUIDANCE;

    // Act
    const clauses = [
      "critical-path work must stay local",
      "do not hand off an urgent blocker",
      "Spawn independent work in the background",
      "continue useful local work",
      "wait only when a result becomes a dependency",
      "Avoid duplicate lanes",
      "Review child evidence and changes",
      "Provider and model are atomic",
    ];

    // Assert
    for (const clause of clauses) expect(guidance).toContain(clause);
    expect(guidance).not.toMatch(/\b(pid|socket|token|available models|active agents|timestamp)\b/i);
  });
});

describe("hasChildLaunchEnvironment", () => {
  test("suppresses the globally loaded parent boundary without consuming child launch values", () => {
    // Arrange
    const environment = {
      PI_SUBAGENT_IPC_SOCKET: "/private/control.sock",
      PI_SUBAGENT_IPC_TOKEN: "ephemeral",
    };

    // Act
    const child = hasChildLaunchEnvironment(environment);

    // Assert
    expect(child).toBe(true);
    expect(environment).toEqual({
      PI_SUBAGENT_IPC_SOCKET: "/private/control.sock",
      PI_SUBAGENT_IPC_TOKEN: "ephemeral",
    });
  });

  test("stays suppressed after the explicit child runtime consumes IPC values", () => {
    // Arrange
    const environment = { PI_SUBAGENT_DEPTH: "2" };

    // Act
    const child = hasChildLaunchEnvironment(environment);

    // Assert
    expect(child).toBe(true);
  });
});
