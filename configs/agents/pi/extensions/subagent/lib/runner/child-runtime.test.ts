import { describe, expect, mock, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import { ORCHESTRATION_GUIDANCE } from "../agents/orchestration-guidance";
import { IpcClientError } from "../ipc/client";
import type { IpcOperation } from "../ipc/protocol";
import { SUBAGENT_MODEL_GUIDANCE } from "../tools/model-guidance";
import {
  CHILD_AGENT_TOOL_NAMES,
  CHILD_COLLABORATION_GUIDANCE,
  type ChildProxyRuntime,
  createEnvironmentChildRuntime,
  registerChildRuntime,
} from "./child-runtime";

function fakeRuntime(result: unknown = { accepted: true }) {
  const request = mock(async (_operation: IpcOperation, _payload: unknown) => result);
  const close = mock(() => {});
  const runtime: ChildProxyRuntime = {
    request: request as ChildProxyRuntime["request"],
    close,
  };
  return { runtime, request, close };
}

describe("registerChildRuntime", () => {
  test("registers exactly the seven collaboration proxies in canonical order", () => {
    // Arrange
    const fakePi = createFakePi();
    const fake = fakeRuntime();

    // Act
    registerChildRuntime(fakePi.pi, fake.runtime);

    // Assert
    expect([...fakePi.tools.keys()]).toEqual([...CHILD_AGENT_TOOL_NAMES]);
    expect([...fakePi.tools.keys()]).not.toContain("agent");
    for (const tool of fakePi.tools.values()) {
      expect(tool.description).not.toBeEmpty();
      expect(tool.promptSnippet).not.toBeEmpty();
      expect(tool.promptGuidelines).toBeArray();
      expect((tool.promptGuidelines as string[]).every((guideline) => guideline.startsWith(`${tool.name}:`))).toBe(
        true,
      );
    }
  });

  test("gives nested agents the shared model selection and orchestration policy", () => {
    // Arrange
    const fakePi = createFakePi();
    const fake = fakeRuntime();

    // Act
    registerChildRuntime(fakePi.pi, fake.runtime);
    const spawn = fakePi.tools.get("agent_spawn");
    const followup = fakePi.tools.get("agent_followup");

    // Assert
    expect(spawn?.description).toEndWith(SUBAGENT_MODEL_GUIDANCE);
    expect(spawn?.description).toContain("Running means the prompt was accepted; queued means startup is waiting");
    expect(spawn?.description).toContain("Neither means completion");
    expect(spawn?.description).toContain("final result is delivered to you");
    expect(followup?.description).toContain("guidance in agent_spawn");
    expect(followup?.description).toContain("Execution changes apply at the next task boundary");
    expect(CHILD_COLLABORATION_GUIDANCE).toEndWith(ORCHESTRATION_GUIDANCE);
    expect(CHILD_COLLABORATION_GUIDANCE).toContain("Your final answer is delivered to your direct parent");
  });

  test("uses the shared message-aware rendering for nested communication tools", () => {
    // Arrange
    const fakePi = createFakePi();
    const fake = fakeRuntime();
    registerChildRuntime(fakePi.pi, fake.runtime);
    const theme = {
      fg: (_color: string, text: string) => text,
      bold: (text: string) => text,
    } as unknown as Theme;
    const renderCall = (name: "agent_send" | "agent_followup") =>
      (
        fakePi.tools.get(name) as unknown as {
          renderCall(args: unknown, theme: Theme): { render(width: number): string[] };
        }
      ).renderCall({ target: "sibling", message: "Share status" }, theme);

    // Act
    const send = renderCall("agent_send")
      .render(120)
      .map((line) => line.trimEnd())
      .join("\n");
    const followup = renderCall("agent_followup")
      .render(120)
      .map((line) => line.trimEnd())
      .join("\n");

    // Assert
    expect(send).toContain("agent_send sibling\n  Share status");
    expect(followup).toContain("agent_followup sibling\n  Share status");
  });

  test("proxies each canonical tool payload without adding caller identity", async () => {
    // Arrange
    const fakePi = createFakePi();
    const fake = fakeRuntime({ routed: true });
    registerChildRuntime(fakePi.pi, fake.runtime);
    const calls: Array<[IpcOperation, unknown]> = [
      ["agent_spawn", { task_name: "nested", subagent_type: "worker", prompt: "work" }],
      ["agent_send", { target: "sibling", message: "status" }],
      ["agent_followup", { target: "sibling", message: "continue" }],
      ["agent_wait", { targets: ["sibling"], condition: "all" }],
      ["agent_interrupt", { target: "sibling" }],
      ["agent_list", {}],
      ["agent_close", { target: "sibling" }],
    ];

    // Act
    for (const [operation, payload] of calls) await fakePi.runTool(operation, payload);

    // Assert
    expect(fake.request).toHaveBeenCalledTimes(7);
    calls.forEach(([operation, payload], index) => {
      expect(fake.request.mock.calls[index]?.slice(0, 2)).toEqual([operation, payload]);
      expect(fake.request.mock.calls[index]?.[1]).not.toHaveProperty("callerPath");
      expect(fake.request.mock.calls[index]?.[1]).not.toHaveProperty("callerId");
    });
  });

  test("proxies authorized opaque artifact pagination through nested agent_wait", async () => {
    // Arrange
    const fakePi = createFakePi();
    const fake = fakeRuntime({ content: "artifact page", eof: true });
    registerChildRuntime(fakePi.pi, fake.runtime);
    const reference = "subagent-artifact:0123456789abcdef0123456789abcdef";

    // Act
    await fakePi.runTool("agent_wait", {
      operation: "read_artifact",
      artifact_ref: reference,
      cursor: 1024,
      page_bytes: 4096,
      page_lines: 40,
    });

    // Assert
    expect(fake.request).toHaveBeenCalledWith(
      "agent_wait",
      {
        operation: "read_artifact",
        artifact_ref: reference,
        cursor: 1024,
        page_bytes: 4096,
        page_lines: 40,
      },
      undefined,
    );
    const definition = fakePi.tools.get("agent_wait");
    expect([definition?.description, ...(definition?.promptGuidelines as string[])].join(" ")).toMatch(
      /direct child.*sibling.*denied.*nextCursor.*host path/i,
    );
  });

  test("preserves nested artifact pagination when IPC returns a worst-case escaped maximum page", async () => {
    // Arrange
    const fakePi = createFakePi();
    const reference = "subagent-artifact:0123456789abcdef0123456789abcdef";
    const content = "\0".repeat(32 * 1024);
    const fake = fakeRuntime({
      reference,
      cursor: 9,
      content,
      bytes: Buffer.byteLength(content),
      lines: 1,
      eof: true,
    });
    registerChildRuntime(fakePi.pi, fake.runtime);

    // Act
    const result = (await fakePi.runTool("agent_wait", {
      operation: "read_artifact",
      artifact_ref: reference,
      page_bytes: 32 * 1024,
    })) as { content: Array<{ type: string; text: string }> };
    const visible = JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}") as {
      bytes: number;
      nextCursor: number;
      eof: boolean;
    };

    // Assert
    expect(visible.nextCursor).toBe(9 + visible.bytes);
    expect(visible.nextCursor).toBeLessThan(9 + Buffer.byteLength(content));
    expect(visible.eof).toBe(false);
  });

  test("injects only stable child guidance and closes the proxy on shutdown", async () => {
    // Arrange
    const fakePi = createFakePi();
    const fake = fakeRuntime();
    registerChildRuntime(fakePi.pi, fake.runtime);

    // Act
    const promptResults = await fakePi.emit("before_agent_start", { systemPrompt: "base" });
    await fakePi.emit("session_shutdown", { reason: "quit" });

    // Assert
    expect(promptResults).toEqual([{ systemPrompt: `base\n\n${CHILD_COLLABORATION_GUIDANCE}` }]);
    expect(JSON.stringify(promptResults)).not.toContain("PI_SUBAGENT_IPC");
    expect(JSON.stringify(promptResults)).not.toContain("/private/control.sock");
    expect(fake.close).toHaveBeenCalledTimes(1);
  });

  test("returns bounded typed proxy failures without transport metadata", async () => {
    // Arrange
    const fakePi = createFakePi();
    const request = mock(async () => {
      throw new IpcClientError("request_failed", "Target is unavailable", "invalid_path");
    });
    const runtime: ChildProxyRuntime = { request: request as ChildProxyRuntime["request"], close: mock(() => {}) };
    registerChildRuntime(fakePi.pi, runtime);

    // Act
    const result = (await fakePi.runTool("agent_send", {
      target: "missing",
      message: "hello",
    })) as { content: Array<{ text: string }>; details: Record<string, unknown> };

    // Assert
    expect(result.details).toMatchObject({
      ok: false,
      operation: "agent_send",
      error: { kind: "invalid_path", message: "Target is unavailable" },
    });
    expect(JSON.stringify(result)).not.toContain("socket");
    expect(JSON.stringify(result)).not.toContain("token");
  });

  test("consumes launch control values before tools can inherit the child environment", () => {
    // Arrange
    const environment: NodeJS.ProcessEnv = {
      PI_SUBAGENT_IPC_SOCKET: "/private/control.sock",
      PI_SUBAGENT_IPC_TOKEN: "ephemeral-secret",
    };

    // Act
    const runtime = createEnvironmentChildRuntime(environment);
    runtime.close();

    // Assert
    expect(environment).toEqual({});
  });

  test("uses a generic unavailable runtime when launch control is absent", async () => {
    // Arrange
    const runtime = createEnvironmentChildRuntime({});

    // Act
    const operation = runtime.request("agent_list", {});

    // Assert
    await expect(operation).rejects.toEqual(new IpcClientError("closed", "Collaboration unavailable"));
  });
});
