import { describe, expect, mock, test } from "bun:test";
import { RpcRequestTimeoutError } from "../rpc/client";
import type { AgentProcessRuntime, ResidentChildExit, ResidentChildProcess } from "./process";
import {
  AgentProcessError,
  createAgentProcess,
  MAX_RPC_COMMAND_TIMEOUT_MS,
  MAX_STDERR_LIMIT_BYTES,
  MAX_TERMINATION_GRACE_MS,
} from "./process";

class FakeResidentChild implements ResidentChildProcess {
  readonly commands: Array<Record<string, unknown>> = [];
  readonly kills: NodeJS.Signals[] = [];
  exitOnSignal: NodeJS.Signals | undefined = "SIGTERM";
  simulateIdleAssignment = false;
  readonly writeStdin = mock((record: string) => {
    const command = JSON.parse(record) as Record<string, unknown>;
    this.commands.push(command);
    if (!this.simulateIdleAssignment) return;

    switch (command.type) {
      case "get_state":
        this.succeed(command, stateData());
        break;
      case "prompt":
        this.succeed(command);
        this.emitMessage({ type: "agent_settled" });
        break;
      case "follow_up":
        this.succeed(command);
        break;
      case "get_last_assistant_text":
        this.succeed(command, { text: "idle follow-up complete" });
        break;
    }
  });
  readonly kill = mock((signal: NodeJS.Signals) => {
    this.kills.push(signal);
    if (signal === this.exitOnSignal) this.emitExit({ code: null, signal });
    return true;
  });
  private readonly stdoutListeners = new Set<(chunk: Uint8Array | string) => void>();
  private readonly stderrListeners = new Set<(chunk: Uint8Array | string) => void>();
  private readonly exitListeners = new Set<(exit: ResidentChildExit) => void>();

  onStdout(listener: (chunk: Uint8Array | string) => void): () => void {
    this.stdoutListeners.add(listener);
    return () => this.stdoutListeners.delete(listener);
  }

  onStderr(listener: (chunk: Uint8Array | string) => void): () => void {
    this.stderrListeners.add(listener);
    return () => this.stderrListeners.delete(listener);
  }

  onExit(listener: (exit: ResidentChildExit) => void): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  emitMessage(message: Record<string, unknown>): void {
    const line = `${JSON.stringify(message)}\n`;
    for (const listener of [...this.stdoutListeners]) listener(line);
  }

  emitStdoutRaw(chunk: string): void {
    for (const listener of [...this.stdoutListeners]) listener(chunk);
  }

  emitStderr(chunk: string): void {
    for (const listener of [...this.stderrListeners]) listener(chunk);
  }

  emitExit(exit: ResidentChildExit): void {
    for (const listener of [...this.exitListeners]) listener(exit);
  }

  lastCommand(): Record<string, unknown> {
    return this.commands.at(-1) ?? {};
  }

  succeedLast(data?: unknown): void {
    this.succeed(this.lastCommand(), data);
  }

  private succeed(command: Record<string, unknown>, data?: unknown): void {
    this.emitMessage({
      id: command.id,
      type: "response",
      command: command.type,
      success: true,
      ...(data === undefined ? {} : { data }),
    });
  }
}

describe("AgentProcess", () => {
  test("rejects process diagnostic and grace configuration beyond hard ranges", () => {
    // Arrange
    const child = new FakeResidentChild();

    // Act
    const oversizedStderr = () => processFixture(child, { stderrLimitBytes: MAX_STDERR_LIMIT_BYTES + 1 });
    const zeroGrace = () => processFixture(child, { terminationGraceMs: 0 });
    const oversizedGrace = () => processFixture(child, { terminationGraceMs: MAX_TERMINATION_GRACE_MS + 1 });
    const oversizedRpcDeadline = () => processFixture(child, { rpcCommandTimeoutMs: MAX_RPC_COMMAND_TIMEOUT_MS + 1 });

    // Assert
    expect(oversizedStderr).toThrow("stderr limit");
    expect(zeroGrace).toThrow("termination grace");
    expect(oversizedGrace).toThrow("termination grace");
    expect(oversizedRpcDeadline).toThrow("RPC command timeout");
  });

  test("starts one persistent child and verifies exact provider, model, and effort", async () => {
    // Arrange
    const child = new FakeResidentChild();
    const { process, spawn } = processFixture(child);

    // Act
    const startup = process.startup();
    child.succeedLast(stateData({ isCompacting: true }));
    const state = await startup;

    // Assert
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(child.commands[0]?.type).toBe("get_state");
    expect(state).toMatchObject({
      status: "running",
      sessionId: "child-session",
      execution: { provider: "openai", model: "gpt-test", effort: "high" },
      isCompacting: true,
    });
  });

  test("fails startup and terminates a child whose effective execution differs", async () => {
    // Arrange
    const child = new FakeResidentChild();
    child.emitStderr("not-yet-listening");
    const { process } = processFixture(child);
    const startup = process.startup();
    child.emitStderr("bounded diagnostic");

    // Act
    child.succeedLast(stateData({ thinkingLevel: "medium" }));

    // Assert
    await expect(startup).rejects.toMatchObject({ kind: "execution_mismatch", stderr: "bounded diagnostic" });
    expect(child.kills).toEqual(["SIGTERM"]);
  });

  test("returns prompt acceptance before settlement and finalizes from authoritative assistant text", async () => {
    // Arrange
    const child = new FakeResidentChild();
    const { process } = processFixture(child);
    await start(process, child);

    // Act
    const acceptedPromise = process.submit({ message: "Implement the fix" });
    expect(child.lastCommand().type).toBe("prompt");
    child.succeedLast();
    const accepted = await acceptedPromise;
    let settled = false;
    accepted.settlement.then(() => {
      settled = true;
    });
    await Promise.resolve();

    child.emitMessage({ type: "agent_end", messages: [] });
    await Promise.resolve();
    const beforeSettled = settled;
    child.emitMessage({ type: "agent_settled" });
    await waitForCommand(child, "get_last_assistant_text");
    child.succeedLast({ text: "complete handoff" });
    await waitForCommand(child, "get_state");
    child.succeedLast(stateData());
    const result = await accepted.settlement;

    // Assert
    expect(accepted.accepted).toBe(true);
    expect(beforeSettled).toBe(false);
    expect(result).toMatchObject({ kind: "settled", output: "complete handoff" });
  });

  test("waits through compaction and queued continuation settlement signals", async () => {
    // Arrange
    const child = new FakeResidentChild();
    const { process } = processFixture(child);
    await start(process, child);
    const submission = process.submit({ message: "Implement the fix" });
    child.succeedLast();
    const accepted = await submission;
    let didSettle = false;
    accepted.settlement.then(() => {
      didSettle = true;
    });

    // Act
    child.emitMessage({ type: "agent_settled" });
    await waitForCommand(child, "get_last_assistant_text");
    child.succeedLast({ text: "before compaction" });
    await waitForCommand(child, "get_state");
    child.succeedLast(stateData({ isCompacting: true }));
    await Promise.resolve();
    expect(didSettle).toBe(false);

    child.emitMessage({ type: "agent_settled" });
    await waitForCommandCount(child, "get_last_assistant_text", 2);
    child.succeedLast({ text: "before continuation" });
    await waitForCommandCount(child, "get_state", 3);
    child.succeedLast(stateData({ pendingMessageCount: 1 }));
    await Promise.resolve();
    expect(didSettle).toBe(false);

    child.emitMessage({ type: "agent_settled" });
    await waitForCommandCount(child, "get_last_assistant_text", 3);
    child.succeedLast({ text: "complete handoff" });
    await waitForCommandCount(child, "get_state", 4);
    child.succeedLast(stateData());
    const result = await accepted.settlement;

    // Assert
    expect(result).toMatchObject({
      output: "complete handoff",
      state: { isStreaming: false, isCompacting: false, pendingMessageCount: 0 },
    });
  });

  test("bounds RPC commands without imposing an overall assignment deadline", async () => {
    // Arrange
    const child = new FakeResidentChild();
    const { process } = processFixture(child, { rpcCommandTimeoutMs: 2 });
    await start(process, child);
    const submission = process.submit({ message: "Long-running work" });
    child.succeedLast();
    const accepted = await submission;

    // Act
    await Bun.sleep(5);
    child.emitMessage({ type: "agent_settled" });
    await waitForCommand(child, "get_last_assistant_text");

    // Assert
    await expect(accepted.settlement).rejects.toBeInstanceOf(RpcRequestTimeoutError);
  });

  test("changes execution before accepting a follow-up and verifies the effective state", async () => {
    // Arrange
    const child = new FakeResidentChild();
    const { process } = processFixture(child);
    await start(process, child);
    const execution = { provider: "xai", model: "grok-test", effort: "medium" as const };

    // Act
    const followupPromise = process.followup({ message: "Now implement", execution });
    expect(child.lastCommand()).toMatchObject({ type: "set_model", provider: "xai", modelId: "grok-test" });
    child.succeedLast({ provider: "xai", id: "grok-test" });
    await waitForCommand(child, "set_thinking_level");
    expect(child.lastCommand()).toMatchObject({ type: "set_thinking_level", level: "medium" });
    child.succeedLast();
    await waitForCommand(child, "get_state");
    child.succeedLast(stateData({ model: { provider: "xai", id: "grok-test" }, thinkingLevel: "medium" }));
    await waitForCommand(child, "prompt");
    expect(child.lastCommand()).toMatchObject({ type: "prompt", message: "Now implement" });
    child.succeedLast();
    const accepted = await followupPromise;

    // Assert
    expect(accepted.accepted).toBe(true);
    expect(child.commands.map((command) => command.type)).toEqual([
      "get_state",
      "set_model",
      "set_thinking_level",
      "get_state",
      "prompt",
    ]);
  });

  test("starts an idle follow-up with prompt and observes a synchronous settlement", async () => {
    // Arrange
    const child = new FakeResidentChild();
    child.simulateIdleAssignment = true;
    const { process } = processFixture(child);
    await process.startup();

    // Act
    const accepted = await process.followup({ message: "Resume idle work" });
    const result = await accepted.settlement;

    // Assert
    expect(child.commands.map((command) => command.type)).toEqual([
      "get_state",
      "prompt",
      "get_last_assistant_text",
      "get_state",
    ]);
    expect(child.commands.some((command) => command.type === "follow_up")).toBe(false);
    expect(result).toMatchObject({ kind: "settled", output: "idle follow-up complete" });
  });

  test("sends steering messages, interrupts work, and forwards runtime events", async () => {
    // Arrange
    const child = new FakeResidentChild();
    const { process } = processFixture(child);
    await start(process, child);
    const listener = mock(() => {});
    process.onEvent(listener);

    // Act
    const send = process.send("Check the mailbox");
    await waitForCommandCount(child, "get_state", 2);
    child.succeedLast(stateData({ isStreaming: true }));
    await waitForCommand(child, "steer");
    child.succeedLast();
    await send;
    const interrupt = process.interrupt();
    child.succeedLast();
    await interrupt;
    child.emitMessage({ type: "tool_execution_start", toolName: "read", toolCallId: "call-1" });

    // Assert
    expect(child.commands.map((command) => command.type)).toEqual(["get_state", "get_state", "steer", "abort"]);
    expect(child.commands[2]).toMatchObject({ message: "Check the mailbox" });
    expect(listener).toHaveBeenCalledWith({
      type: "runtime",
      name: "tool_execution_start",
      payload: { toolName: "read", toolCallId: "call-1" },
    });
  });

  test("starts a steering continuation when a send races an idle settlement", async () => {
    // Arrange
    const child = new FakeResidentChild();
    const { process } = processFixture(child);
    await start(process, child);

    // Act
    const send = process.send("Continue after settlement");
    await waitForCommandCount(child, "get_state", 2);
    child.succeedLast(stateData({ isStreaming: false }));
    await waitForCommand(child, "prompt");
    child.succeedLast();
    await send;

    // Assert
    expect(child.commands.at(-1)).toMatchObject({
      type: "prompt",
      message: "Continue after settlement",
      streamingBehavior: "steer",
    });
  });

  test("rejects a second assignment while the first remains active", async () => {
    // Arrange
    const child = new FakeResidentChild();
    const { process } = processFixture(child);
    await start(process, child);
    const firstPromise = process.submit({ message: "First" });
    child.succeedLast();
    await firstPromise;

    // Act
    const second = process.submit({ message: "Second" });

    // Assert
    await expect(second).rejects.toMatchObject({ kind: "assignment_active" });
  });

  test("bounds stderr to its configured byte tail", async () => {
    // Arrange
    const child = new FakeResidentChild();
    const { process } = processFixture(child, { stderrLimitBytes: 8 });
    const startup = process.startup();

    // Act
    child.emitStderr("1234567890");
    child.succeedLast(stateData());
    await startup;

    // Assert
    expect(process.getStderrTail()).toBe("34567890");
  });

  test("redacts malformed stdout diagnostics before rejecting startup", async () => {
    // Arrange
    const secret = "provider-token-sentinel-123";
    const child = new FakeResidentChild();
    const { process } = processFixture(child, {
      redact: (value) => value.replaceAll(secret, "[REDACTED]"),
    });
    const startup = process.startup();

    // Act
    child.emitStdoutRaw(`{"value":"${secret}" trailing\n`);
    const error = await startup.catch((caught: unknown) => caught);

    // Assert
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("[REDACTED]");
    expect((error as Error).message).not.toContain(secret);
  });

  test("redacts known secrets from assistant output, stderr, malformed RPC, and runtime events", async () => {
    // Arrange
    const secret = "provider-token-sentinel-123";
    const child = new FakeResidentChild();
    const { process } = processFixture(child, {
      redact: (value) => value.replaceAll(secret, "[REDACTED]"),
    });
    await start(process, child);
    const listener = mock(() => {});
    process.onEvent(listener);
    const submit = process.submit({ message: "Work" });
    child.succeedLast();
    const accepted = await submit;

    // Act
    child.emitStderr(`failure ${secret}`);
    child.emitMessage({ type: "tool_execution_start", detail: `event ${secret}` });
    child.emitMessage({ type: "agent_settled" });
    await waitForCommand(child, "get_last_assistant_text");
    child.succeedLast({ text: `normal output ${secret}` });
    await waitForCommand(child, "get_state");
    child.succeedLast(stateData());
    const settled = await accepted.settlement;

    // Assert
    expect(settled.output).toBe("normal output [REDACTED]");
    expect(process.getStderrTail()).toBe("failure [REDACTED]");
    expect(JSON.stringify(listener.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(listener.mock.calls)).toContain("event [REDACTED]");
  });

  test("closes gracefully with SIGTERM and escalates to SIGKILL after the grace period", async () => {
    // Arrange
    const child = new FakeResidentChild();
    child.exitOnSignal = "SIGKILL";
    const { process } = processFixture(child, { terminationGraceMs: 1 });
    await start(process, child);

    // Act
    await process.close();

    // Assert
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
    await expect(process.getState()).rejects.toMatchObject({ kind: "closed" });
  });

  test("reports child exit and rejects an in-flight settlement", async () => {
    // Arrange
    const child = new FakeResidentChild();
    const { process } = processFixture(child);
    await start(process, child);
    const listener = mock(() => {});
    process.onEvent(listener);
    const submit = process.submit({ message: "Work" });
    child.succeedLast();
    const accepted = await submit;

    // Act
    child.emitExit({ code: 7, signal: null });

    // Assert
    expect(listener).toHaveBeenCalledWith({ type: "exit", code: 7, signal: null });
    await expect(accepted.settlement).rejects.toBeInstanceOf(AgentProcessError);
  });
});

async function start(process: ReturnType<typeof createAgentProcess>, child: FakeResidentChild): Promise<void> {
  const startup = process.startup();
  child.succeedLast(stateData());
  await startup;
}

async function waitForCommand(child: FakeResidentChild, type: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (child.lastCommand().type === type) return;
    await Promise.resolve();
  }
  throw new Error(`Timed out waiting for fake RPC command ${type}`);
}

async function waitForCommandCount(child: FakeResidentChild, type: string, count: number): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (child.commands.filter((command) => command.type === type).length >= count) return;
    await Promise.resolve();
  }
  throw new Error(`Timed out waiting for ${count} fake RPC commands of type ${type}`);
}

function processFixture(
  child: FakeResidentChild,
  overrides: {
    stderrLimitBytes?: number;
    terminationGraceMs?: number;
    rpcCommandTimeoutMs?: number;
    redact?: (value: string) => string;
  } = {},
) {
  const spawn = mock(() => child);
  const runtime: AgentProcessRuntime = { spawn };
  const process = createAgentProcess({
    invocation: {
      command: "pi",
      args: ["--mode", "rpc"],
      cwd: "/repo",
      env: {},
    },
    execution: { provider: "openai", model: "gpt-test", effort: "high" },
    runtime,
    ...overrides,
  });
  return { process, spawn };
}

function stateData(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    model: { provider: "openai", id: "gpt-test" },
    thinkingLevel: "high",
    isStreaming: false,
    isCompacting: false,
    sessionFile: "/sessions/child.jsonl",
    sessionId: "child-session",
    pendingMessageCount: 0,
    ...overrides,
  };
}
