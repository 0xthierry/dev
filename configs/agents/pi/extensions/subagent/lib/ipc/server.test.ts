import { describe, expect, mock, test } from "bun:test";
import type { ResolvedAgentExecution } from "../execution/profile";
import { type AgentSupervisor, SupervisorError } from "../supervisor/supervisor";
import { createCapabilityAuthority } from "./authentication";
import {
  encodeIpcFrame,
  IPC_PROTOCOL_VERSION,
  IPC_RECORD_LIMIT_BYTES,
  parseOperationPayload,
  requestFrame,
} from "./protocol";
import {
  type AuthenticatedIpcDispatcher,
  createIpcServer,
  createSupervisorIpcDispatcher,
  type IpcServerConnection,
  type IpcServerRuntime,
} from "./server";

class FakeConnection implements IpcServerConnection {
  readonly writes: string[] = [];
  readonly write = mock((record: string) => this.writes.push(record));
  readonly close = mock(() => this.emitClose());
  private dataListeners = new Set<(chunk: Uint8Array | string) => void>();
  private closeListeners = new Set<() => void>();

  onData(listener: (chunk: Uint8Array | string) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  emitData(chunk: Uint8Array | string): void {
    for (const listener of [...this.dataListeners]) listener(chunk);
  }

  emitClose(): void {
    for (const listener of [...this.closeListeners]) listener();
  }
}

const caller = { agentId: "agent-child", agentPath: "/root/parent/child" };

function response(connection: FakeConnection, index = 0): Record<string, unknown> {
  return JSON.parse(connection.writes[index] ?? "{}") as Record<string, unknown>;
}

function authenticate(connection: FakeConnection, token: string): void {
  connection.emitData(encodeIpcFrame(requestFrame("auth", "authenticate", { token })));
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("IpcServer", () => {
  test("derives caller identity from the capability and preserves split UTF-8 framing", async () => {
    // Arrange
    const authority = createCapabilityAuthority();
    const capability = authority.issue(caller);
    const dispatch = mock(async (request) => ({ caller: request.caller, payload: request.payload }));
    const dispatcher: AuthenticatedIpcDispatcher = { dispatch };
    const server = createIpcServer({ socketPath: "/private/control.sock", authority, dispatcher });
    const connection = new FakeConnection();
    server.accept(connection);
    authenticate(connection, capability.token);
    const encoded = Buffer.from(
      encodeIpcFrame(requestFrame("send-1", "agent_send", { target: "/root/parent", message: "hi 🌍" })),
    );
    const emoji = encoded.indexOf(Buffer.from("🌍"));

    // Act
    connection.emitData(encoded.subarray(0, emoji + 1));
    connection.emitData(encoded.subarray(emoji + 1));
    await flush();

    // Assert
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0]?.[0]).toMatchObject({
      caller,
      operation: "agent_send",
      payload: { target: "/root/parent", message: "hi 🌍" },
    });
    expect(response(connection, 1)).toMatchObject({ id: "send-1", ok: true });
  });

  test("closes silently on authentication failure and caller spoof fields", async () => {
    // Arrange
    const authority = createCapabilityAuthority();
    const capability = authority.issue(caller);
    const dispatcher: AuthenticatedIpcDispatcher = { dispatch: mock(async () => ({})) };
    const server = createIpcServer({ socketPath: "/private/control.sock", authority, dispatcher });
    const unauthenticated = new FakeConnection();
    const spoofing = new FakeConnection();
    server.accept(unauthenticated);
    server.accept(spoofing);

    // Act
    authenticate(unauthenticated, `${capability.token}bad`);
    authenticate(spoofing, capability.token);
    spoofing.emitData(
      encodeIpcFrame(
        requestFrame("spawn", "agent_spawn", {
          task_name: "nested",
          subagent_type: "worker",
          prompt: "work",
          parentPath: "/root/spoofed",
        }),
      ),
    );
    await flush();

    // Assert
    expect(unauthenticated.close).toHaveBeenCalledTimes(1);
    expect(unauthenticated.writes).toEqual([]);
    expect(spoofing.close).toHaveBeenCalledTimes(1);
    expect(spoofing.writes).toHaveLength(1);
    expect(dispatcher.dispatch).not.toHaveBeenCalled();
  });

  test("redacts exact control values from successful and failed dispatch responses", async () => {
    // Arrange
    const authority = createCapabilityAuthority();
    const capability = authority.issue(caller);
    const secret = "abc1234";
    const dispatcher: AuthenticatedIpcDispatcher = {
      dispatch: mock(async (request) => {
        if (request.operation === "agent_list") return { output: `${secret} ${capability.token}` };
        throw new SupervisorError("invalid_message", `${secret} ${capability.token}`);
      }),
    };
    const server = createIpcServer({
      socketPath: "/private/control.sock",
      authority,
      dispatcher,
      redact: (value) => value.replaceAll(secret, "[REDACTED]"),
    });
    const connection = new FakeConnection();
    server.accept(connection);
    authenticate(connection, capability.token);

    // Act
    connection.emitData(encodeIpcFrame(requestFrame("list", "agent_list", {})));
    connection.emitData(
      encodeIpcFrame(requestFrame("send", "agent_send", { target: "/root/parent", message: "safe" })),
    );
    await flush();

    // Assert
    expect(connection.writes).toHaveLength(3);
    expect(connection.writes.join("\n")).toContain("[REDACTED]");
    expect(connection.writes.join("\n")).not.toContain(secret);
    expect(connection.writes.join("\n")).not.toContain(capability.token);
  });

  test("fails closed on malformed and oversized records", () => {
    // Arrange
    const dispatcher: AuthenticatedIpcDispatcher = { dispatch: mock(async () => ({})) };
    const malformedServer = createIpcServer({ socketPath: "/private/control.sock", dispatcher });
    const oversizedServer = createIpcServer({ socketPath: "/private/control-2.sock", dispatcher });
    const malformed = new FakeConnection();
    const oversized = new FakeConnection();
    malformedServer.accept(malformed);
    oversizedServer.accept(oversized);

    // Act
    malformed.emitData("{bad}\n");
    oversized.emitData(Buffer.alloc(IPC_RECORD_LIMIT_BYTES + 1, 0x61));

    // Assert
    expect(malformed.close).toHaveBeenCalledTimes(1);
    expect(oversized.close).toHaveBeenCalledTimes(1);
    expect(malformed.writes).toEqual([]);
    expect(oversized.writes).toEqual([]);
  });

  test("propagates cancellation to a long request without returning a late response", async () => {
    // Arrange
    const authority = createCapabilityAuthority();
    const capability = authority.issue(caller);
    let requestSignal: AbortSignal | undefined;
    const dispatcher: AuthenticatedIpcDispatcher = {
      dispatch: mock(async (_request, signal) => {
        requestSignal = signal;
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }),
    };
    const server = createIpcServer({ socketPath: "/private/control.sock", authority, dispatcher });
    const connection = new FakeConnection();
    server.accept(connection);
    authenticate(connection, capability.token);
    connection.emitData(
      encodeIpcFrame(requestFrame("wait-1", "agent_wait", { targets: ["/root/parent"], condition: "all" })),
    );

    // Act
    connection.emitData(`${JSON.stringify({ version: IPC_PROTOCOL_VERSION, type: "cancel", id: "wait-1" })}\r\n`);
    await flush();

    // Assert
    expect(requestSignal?.aborted).toBe(true);
    expect(connection.writes).toHaveLength(1);
    expect(connection.close).not.toHaveBeenCalled();
  });

  test("starts once lazily and cleans listener, connections, capabilities, and socket", async () => {
    // Arrange
    let acceptConnection: ((connection: IpcServerConnection) => void) | undefined;
    const listener = { close: mock(async () => {}) };
    const runtime: IpcServerRuntime = {
      prepare: mock(async () => {}),
      listen: mock(async (_path, accept) => {
        acceptConnection = accept;
        return listener;
      }),
      cleanup: mock(async () => {}),
    };
    const authority = createCapabilityAuthority();
    const capability = authority.issue(caller);
    const server = createIpcServer({
      socketPath: "/private/control.sock",
      authority,
      runtime,
      dispatcher: { dispatch: mock(async () => ({})) },
    });

    // Act
    await Promise.all([server.start(), server.start()]);
    const connection = new FakeConnection();
    acceptConnection?.(connection);
    await server.stop();

    // Assert
    expect(runtime.prepare).toHaveBeenCalledTimes(1);
    expect(runtime.listen).toHaveBeenCalledTimes(1);
    expect(listener.close).toHaveBeenCalledTimes(1);
    expect(connection.close).toHaveBeenCalledTimes(1);
    expect(authority.authenticate(capability.token)).toBeUndefined();
    expect(runtime.cleanup).toHaveBeenCalledWith("/private/control.sock");
  });
});

describe("artifact read IPC payload", () => {
  test("strictly parses bounded opaque artifact pagination without caller fields", () => {
    // Arrange
    const reference = "subagent-artifact:0123456789abcdef0123456789abcdef";

    // Act
    const parsed = parseOperationPayload("agent_wait", {
      operation: "read_artifact",
      artifact_ref: reference,
      cursor: 12,
      page_bytes: 4096,
      page_lines: 40,
    });

    // Assert
    expect(parsed).toEqual({
      operation: "read_artifact",
      artifact_ref: reference,
      cursor: 12,
      page_bytes: 4096,
      page_lines: 40,
    });
    expect(() =>
      parseOperationPayload("agent_wait", {
        operation: "read_artifact",
        artifact_ref: reference,
        caller: "/root/forged",
      }),
    ).toThrow("unknown fields");
    expect(() =>
      parseOperationPayload("agent_wait", {
        operation: "read_artifact",
        artifact_ref: "../../secret",
      }),
    ).toThrow("opaque artifact reference");
  });
});

describe("createSupervisorIpcDispatcher", () => {
  test("roots nested spawn and sender identity below the authenticated caller", async () => {
    // Arrange
    const execution: ResolvedAgentExecution = {
      profile: { provider: "test", model: "small", effort: "medium" },
      source: { model: "parent", effort: "parent" },
    };
    const entries = [
      { agentPath: "/root/parent", agentId: "parent", agentType: "worker", status: "idle" as const, execution },
      {
        agentPath: caller.agentPath,
        agentId: caller.agentId,
        agentType: "worker",
        status: "running" as const,
        execution,
      },
      {
        agentPath: "/root/parent/sibling",
        agentId: "sibling",
        agentType: "worker",
        status: "idle" as const,
        execution,
      },
      { agentPath: "/root/outsider", agentId: "outsider", agentType: "worker", status: "idle" as const, execution },
    ];
    const supervisor = fakeSupervisor(entries);
    const resolve = mock(async () => execution);
    const resolveForkParentSession = mock(async () => "/sessions/caller.jsonl");
    const dispatcher = createSupervisorIpcDispatcher({
      supervisor,
      execution: { resolve, resolveForkParentSession },
    });
    const signal = new AbortController().signal;

    // Act
    await dispatcher.dispatch(
      {
        caller,
        operation: "agent_spawn",
        payload: {
          task_name: "nested",
          subagent_type: "worker",
          prompt: "work",
          context: { fork_turns: "all" },
        },
      },
      signal,
    );
    await dispatcher.dispatch(
      { caller, operation: "agent_send", payload: { target: "sibling", message: "status" } },
      signal,
    );
    await dispatcher.dispatch(
      {
        caller,
        operation: "agent_followup",
        payload: { target: "sibling", message: "continue", execution: { effort: "high" } },
      },
      signal,
    );
    await dispatcher.dispatch(
      { caller, operation: "agent_wait", payload: { targets: ["sibling"], condition: "any", timeout_seconds: 2 } },
      signal,
    );
    await dispatcher.dispatch({ caller, operation: "agent_interrupt", payload: { target: "sibling" } }, signal);
    const visible = await dispatcher.dispatch({ caller, operation: "agent_list", payload: {} }, signal);
    await dispatcher.dispatch({ caller, operation: "agent_close", payload: { target: "sibling" } }, signal);

    // Assert
    expect(supervisor.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        parentPath: caller.agentPath,
        context: { kind: "fork", parentSessionFile: "/sessions/caller.jsonl" },
      }),
    );
    expect(supervisor.send).toHaveBeenCalledWith(
      expect.objectContaining({ senderPath: caller.agentPath, target: "/root/parent/sibling" }),
    );
    expect(supervisor.followup).toHaveBeenCalledWith(
      expect.objectContaining({ target: "/root/parent/sibling", execution }),
    );
    expect(supervisor.wait).toHaveBeenCalledWith(
      expect.objectContaining({ targets: ["/root/parent/sibling"], condition: "any", timeoutMs: 2_000 }),
    );
    expect(supervisor.interrupt).toHaveBeenCalledWith("/root/parent/sibling", signal);
    expect(supervisor.close).toHaveBeenCalledWith("/root/parent/sibling", signal);
    expect(visible).toEqual(entries.slice(0, 3));
  });

  test("passes only the authenticated caller to artifact authorization", async () => {
    // Arrange
    const execution: ResolvedAgentExecution = {
      profile: { provider: "test", model: "small", effort: "medium" },
      source: { model: "parent", effort: "parent" },
    };
    const supervisor = fakeSupervisor([
      {
        agentPath: caller.agentPath,
        agentId: caller.agentId,
        agentType: "worker",
        status: "running" as const,
        execution,
      },
    ]);
    const read = mock(async () => ({
      reference: "subagent-artifact:0123456789abcdef0123456789abcdef",
      cursor: 0,
      content: "leaf page",
      bytes: 9,
      lines: 1,
      eof: true,
    }));
    const dispatcher = createSupervisorIpcDispatcher({
      supervisor,
      execution: { resolve: mock(async () => execution) },
      artifacts: { read },
    });
    const signal = new AbortController().signal;

    // Act
    const result = await dispatcher.dispatch(
      {
        caller,
        operation: "agent_wait",
        payload: {
          operation: "read_artifact",
          artifact_ref: "subagent-artifact:0123456789abcdef0123456789abcdef",
          cursor: 0,
        },
      },
      signal,
    );

    // Assert
    expect(read).toHaveBeenCalledWith(
      caller,
      "subagent-artifact:0123456789abcdef0123456789abcdef",
      { cursor: 0, maxBytes: undefined, maxLines: undefined },
      signal,
    );
    expect(result).toMatchObject({ content: "leaf page", eof: true });
    expect(supervisor.wait).not.toHaveBeenCalled();
  });

  test("rejects targets outside centrally derived visibility", async () => {
    // Arrange
    const execution: ResolvedAgentExecution = {
      profile: { provider: "test", model: "small", effort: "medium" },
      source: { model: "parent", effort: "parent" },
    };
    const supervisor = fakeSupervisor([
      {
        agentPath: caller.agentPath,
        agentId: caller.agentId,
        agentType: "worker",
        status: "running" as const,
        execution,
      },
      { agentPath: "/root/outsider", agentId: "outsider", agentType: "worker", status: "idle" as const, execution },
    ]);
    const dispatcher = createSupervisorIpcDispatcher({
      supervisor,
      execution: { resolve: mock(async () => execution) },
    });

    // Act
    const operation = dispatcher.dispatch(
      { caller, operation: "agent_send", payload: { target: "outsider", message: "spoof" } },
      new AbortController().signal,
    );

    // Assert
    await expect(operation).rejects.toMatchObject({ kind: "invalid_path" });
    expect(supervisor.send).not.toHaveBeenCalled();
  });
});

function fakeSupervisor(entries: Awaited<ReturnType<AgentSupervisor["list"]>>): AgentSupervisor {
  const first = entries[0];
  if (!first) throw new Error("Fake supervisor requires one entry");
  return {
    spawn: mock(async (request) => ({
      agentPath: `${request.parentPath}/${request.taskName}`,
      agentId: "nested",
      assignmentId: "nested:1",
      status: "running" as const,
      execution: request.execution,
    })),
    send: mock(async (request) => ({ agentPath: request.target, agentId: "target", delivery: "steered" as const })),
    followup: mock(async (request) => ({
      agentPath: request.target,
      agentId: "target",
      assignmentId: "target:2",
      status: "running" as const,
      execution: request.execution ?? first.execution,
    })),
    wait: mock(async () => ({ condition: "all" as const, timedOut: false, completed: [], pending: [] })),
    interrupt: mock(async () => first),
    list: mock(async () => entries),
    close: mock(async () => first),
    clearSettledActivities: mock(() => undefined),
    restore: mock(async () => {}),
    shutdown: mock(async () => {}),
  };
}
