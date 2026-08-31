import { describe, expect, mock, test } from "bun:test";
import { ArtifactTooLargeError, MAX_ARTIFACT_BYTES } from "../artifacts/artifacts";
import type { ResolvedAgentExecution } from "../execution/profile";
import type { AgentProcessState, AgentSettlement } from "../runner/process";
import type { SubagentRuntimeEntry } from "../sessions/entries";
import type { FinalAnswerNotification } from "./mailbox";
import {
  type CreateSupervisorProcessRequest,
  createAgentSupervisor,
  type SupervisorAgentProcess,
  type SupervisorRuntime,
} from "./supervisor";

const execution: ResolvedAgentExecution = {
  profile: { provider: "test", model: "small", effort: "medium" },
  source: { model: "parent", effort: "parent" },
};

const strongerExecution: ResolvedAgentExecution = {
  profile: { provider: "test", model: "large", effort: "high" },
  source: { model: "invocation", effort: "invocation" },
};

interface DeferredSettlement {
  promise: Promise<AgentSettlement>;
  resolve(output: string): void;
  reject(error: Error): void;
}

interface FakeProcess extends SupervisorAgentProcess {
  startup: ReturnType<typeof mock>;
  submit: ReturnType<typeof mock>;
  send: ReturnType<typeof mock>;
  followup: ReturnType<typeof mock>;
  interrupt: ReturnType<typeof mock>;
  onEvent: ReturnType<typeof mock>;
  close: ReturnType<typeof mock>;
  assignments: DeferredSettlement[];
}

function settlement(sessionFile: string): DeferredSettlement {
  let resolvePromise!: (value: AgentSettlement) => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<AgentSettlement>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve(output) {
      resolvePromise({ kind: "settled", output, state: processState(sessionFile, false) });
    },
    reject: rejectPromise,
  };
}

function processState(sessionFile: string, streaming = true): AgentProcessState {
  return {
    status: "running",
    sessionId: `session:${sessionFile}`,
    sessionFile,
    execution: { provider: "test", model: "small", effort: "medium" },
    isStreaming: streaming,
    pendingMessageCount: 0,
  };
}

function createFakeProcess(path: string): FakeProcess {
  const sessionFile = `/sessions/${path.slice(1).replaceAll("/", "-")}.jsonl`;
  const assignments: DeferredSettlement[] = [];
  const accept = mock(async () => {
    const next = settlement(sessionFile);
    assignments.push(next);
    return { accepted: true as const, settlement: next.promise };
  });
  return {
    assignments,
    startup: mock(async () => processState(sessionFile)),
    submit: accept,
    send: mock(async () => {}),
    followup: mock(async () => {
      const next = settlement(sessionFile);
      assignments.push(next);
      return { accepted: true as const, settlement: next.promise };
    }),
    interrupt: mock(async () => {}),
    onEvent: mock(() => () => {}),
    close: mock(async () => {}),
  };
}

function harness(options?: {
  active?: number;
  resident?: number;
  redact?: (value: string) => string;
  mailboxMessages?: number;
}) {
  let agentId = 0;
  let mailId = 0;
  let artifactId = 0;
  const entries: SubagentRuntimeEntry[] = [];
  const artifactContents = new Map<string, string>();
  const processes = new Map<string, FakeProcess>();
  const deliverRootCompletion = mock(async (_notification: FinalAnswerNotification) => {});
  const createProcess = mock((request: CreateSupervisorProcessRequest) => {
    const process = createFakeProcess(request.agentPath);
    processes.set(request.agentPath, process);
    return process;
  });
  const artifactWrite = mock(async (input: { content: string }) => {
    const reference = `subagent-artifact:${String(++artifactId).padStart(32, "0")}`;
    artifactContents.set(reference, input.content);
    return { reference };
  });
  const runtime: SupervisorRuntime = {
    createAgentId: mock(() => `agent-${++agentId}`),
    createMailId: mock(() => `mail-${++mailId}`),
    createProcess,
    deliverRootCompletion,
    journal: {
      append: mock((entry: SubagentRuntimeEntry) => {
        entries.push(entry);
      }),
    },
    artifacts: {
      write: artifactWrite,
      read: mock(async (reference) => {
        const content = artifactContents.get(reference);
        return content === undefined ? { ok: false as const, reason: "not-found" } : { ok: true as const, content };
      }),
    },
  };
  const supervisor = createAgentSupervisor(runtime, {
    limits: {
      maxActiveAgents: options?.active ?? 3,
      maxResidentAgents: options?.resident ?? 6,
      maxDepth: 3,
    },
    redact: options?.redact,
    ...(options?.mailboxMessages
      ? {
          mailboxLimits: {
            maxMessagesPerTarget: options.mailboxMessages,
            maxMessageBytes: 256,
            maxTargetBytes: 1024,
          },
        }
      : {}),
  });
  return {
    supervisor,
    runtime,
    entries,
    processes,
    createProcess,
    deliverRootCompletion,
    artifactContents,
    artifactWrite,
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("PersistentAgentSupervisor", () => {
  test("returns spawn on prompt acceptance and waits by assignment identity", async () => {
    // Arrange
    const fake = harness();

    // Act
    const spawned = await fake.supervisor.spawn({
      taskName: "review",
      agentType: "scout",
      prompt: "Review the code",
      execution,
    });
    const process = fake.processes.get("/root/review");

    // Assert
    expect(spawned).toMatchObject({
      agentPath: "/root/review",
      agentId: "agent-1",
      assignmentId: "agent-1:1",
      status: "running",
    });
    expect(process?.assignments).toHaveLength(1);
    expect(fake.runtime.artifacts.write).not.toHaveBeenCalled();

    // Act
    process?.assignments[0]?.resolve("finished review");
    const waited = await fake.supervisor.wait({ targets: [spawned.agentId], timeoutMs: 1_000 });

    // Assert
    expect(waited.timedOut).toBe(false);
    expect(waited.completed[0]).toMatchObject({
      agentPath: "/root/review",
      assignmentId: "agent-1:1",
      outcome: "completed",
    });
    expect(waited.completed[0]?.artifactReference).toStartWith("subagent-artifact:");
    expect(fake.entries.map((entry) => entry.event)).toEqual(["spawned", "started", "completed"]);
    expect(fake.entries[1]).toMatchObject({ event: "started", generation: 1 });
    expect(fake.entries[2]).toMatchObject({ event: "completed", generation: 1 });
  });

  test("accepts task names and prompts above the retired policy caps", async () => {
    // Arrange
    const fake = harness();
    const taskName = `task-${"x".repeat(8 * 1024)}`;
    const prompt = "p".repeat(300 * 1024);

    // Act
    const spawned = await fake.supervisor.spawn({ taskName, agentType: "worker", prompt, execution });

    // Assert
    expect(spawned.agentPath).toBe(`/root/${taskName}`);
    expect(fake.processes.get(spawned.agentPath)?.submit.mock.calls[0]?.[0]).toMatchObject({ message: prompt });
  });

  test("waits on more targets than the retired target cap", async () => {
    // Arrange
    const fake = harness({ active: 40, resident: 40 });
    const agents = await Promise.all(
      Array.from({ length: 33 }, (_, index) =>
        fake.supervisor.spawn({ taskName: `wait-${index}`, agentType: "worker", prompt: "work", execution }),
      ),
    );

    // Act
    const waited = await fake.supervisor.wait({
      targets: agents.map((agent) => agent.agentId),
      timeoutMs: 0,
    });

    // Assert
    expect(waited.pending).toHaveLength(33);
  });

  test("steers running work and queues a follow-up behind its active generation", async () => {
    // Arrange
    const fake = harness();
    const spawned = await fake.supervisor.spawn({
      taskName: "worker",
      agentType: "worker",
      prompt: "first",
      execution,
    });
    const process = fake.processes.get(spawned.agentPath);

    // Act
    const sent = await fake.supervisor.send({ target: spawned.agentPath, message: "status?" });
    const followup = await fake.supervisor.followup({
      target: spawned.agentId,
      message: "second",
      execution: strongerExecution,
    });

    // Assert
    expect(sent.delivery).toBe("steered");
    expect(process?.send).toHaveBeenCalledWith("status?", undefined);
    expect(followup).toMatchObject({ assignmentId: "agent-1:2", status: "queued" });
    expect(process?.followup).not.toHaveBeenCalled();

    // Act
    process?.assignments[0]?.resolve("first done");
    let listed = await fake.supervisor.list();
    for (let attempt = 0; attempt < 10 && listed[0]?.execution.profile.model !== "large"; attempt += 1) {
      await flush();
      listed = await fake.supervisor.list();
    }

    // Assert
    expect(process?.followup).toHaveBeenCalledTimes(1);
    expect(listed[0]?.execution).toEqual(strongerExecution);
    expect(fake.entries).toContainEqual(
      expect.objectContaining({ event: "execution_changed", execution: strongerExecution }),
    );
    process?.assignments[1]?.resolve("second done");
    const secondWait = await fake.supervisor.wait({ targets: [spawned.agentPath], timeoutMs: 1_000 });
    expect(secondWait.completed[0]?.assignmentId).toBe("agent-1:2");
  });

  test("exposes scheduler queueing and never evicts the resident child", async () => {
    // Arrange
    const fake = harness({ active: 1, resident: 2 });
    const first = await fake.supervisor.spawn({
      taskName: "a",
      agentType: "worker",
      prompt: "first",
      execution,
    });

    // Act
    const second = await fake.supervisor.spawn({
      taskName: "b",
      agentType: "worker",
      prompt: "second",
      execution,
    });

    // Assert
    expect(second.status).toBe("queued");
    expect(fake.createProcess).toHaveBeenCalledTimes(1);

    // Act
    fake.processes.get(first.agentPath)?.assignments[0]?.resolve("done");
    const firstWait = await fake.supervisor.wait({ targets: [first.agentPath], timeoutMs: 1_000 });
    await flush();

    // Assert
    expect(firstWait.timedOut).toBe(false);
    expect(fake.createProcess).toHaveBeenCalledTimes(2);
    expect(fake.processes.get(first.agentPath)?.close).not.toHaveBeenCalled();
    const secondProcess = fake.processes.get(second.agentPath);
    for (let attempt = 0; attempt < 10 && secondProcess?.assignments.length === 0; attempt += 1) await flush();
    expect(secondProcess?.assignments).toHaveLength(1);
    secondProcess?.assignments[0]?.resolve("done too");
    await fake.supervisor.wait({ targets: [second.agentPath], timeoutMs: 1_000 });
  });

  test("rejects full mailbox sends before writing orphan handoff artifacts", async () => {
    // Arrange
    const fake = harness({ mailboxMessages: 1 });
    await fake.supervisor.restore([
      {
        agentPath: "/root/saved",
        agentId: "saved-agent",
        agentType: "worker",
        sessionFile: "/sessions/saved.jsonl",
        execution,
        assignmentGeneration: 0,
        queuedMailIds: [],
      },
    ]);
    await fake.supervisor.send({ target: "/root/saved", message: "first" });
    const writesAfterFirst = fake.artifactWrite.mock.calls.length;

    // Act
    const overflow = fake.supervisor.send({ target: "/root/saved", message: "second" });

    // Assert
    await expect(overflow).rejects.toMatchObject({ kind: "mailbox_full" });
    expect(fake.artifactWrite).toHaveBeenCalledTimes(writesAfterFirst);
    expect(fake.artifactContents.size).toBe(1);
  });

  test("reserves direct-parent completion mail before writing its durable handoff", async () => {
    // Arrange
    const fake = harness({ mailboxMessages: 1 });
    await fake.supervisor.restore([
      {
        agentPath: "/root/parent",
        agentId: "parent-agent",
        agentType: "worker",
        sessionFile: "/sessions/parent.jsonl",
        execution,
        assignmentGeneration: 0,
        queuedMailIds: [],
      },
    ]);
    await fake.supervisor.send({ target: "/root/parent", message: "fills mailbox" });
    const child = await fake.supervisor.spawn({
      parentPath: "/root/parent",
      taskName: "child",
      agentType: "worker",
      prompt: "work",
      execution,
    });

    // Act
    fake.processes.get(child.agentPath)?.assignments[0]?.resolve("child completion");
    const waited = await fake.supervisor.wait({ targets: [child.agentPath], timeoutMs: 1_000 });

    // Assert
    expect(waited.completed[0]?.notification).toMatchObject({
      status: "failed",
      failure: { kind: "parent_mailbox_failed", targetPath: "/root/parent" },
    });
    expect(fake.artifactWrite).toHaveBeenCalledTimes(2);
    expect(fake.artifactContents.size).toBe(2);
  });

  test("queues mail for unloaded recovery, reloads lazily, and closes terminally", async () => {
    // Arrange
    const fake = harness();
    await fake.supervisor.restore([
      {
        agentPath: "/root/recovered",
        agentId: "saved-id",
        agentType: "worker",
        sessionFile: "/sessions/saved.jsonl",
        execution,
        assignmentGeneration: 2,
        queuedMailIds: [],
      },
    ]);

    // Act
    const sent = await fake.supervisor.send({ target: "saved-id", message: "queued mail" });
    const recovered = createAgentSupervisor(fake.runtime, {
      limits: { maxActiveAgents: 3, maxResidentAgents: 6, maxDepth: 3 },
    });
    await recovered.restore([
      {
        agentPath: "/root/recovered",
        agentId: "saved-id",
        agentType: "worker",
        sessionFile: "/sessions/saved.jsonl",
        execution,
        assignmentGeneration: 2,
        queuedMailIds: [sent.mailId ?? ""],
      },
    ]);
    const followup = await recovered.followup({ target: "saved-id", message: "resume" });
    await flush();
    const process = fake.processes.get("/root/recovered");

    // Assert
    expect(sent.delivery).toBe("queued");
    expect(followup).toMatchObject({ status: "running", assignmentId: "saved-id:3" });
    expect(fake.createProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        session: { kind: "recovered", sessionFile: "/sessions/saved.jsonl" },
      }),
    );
    expect(process?.send).toHaveBeenCalledWith("queued mail", expect.any(AbortSignal));

    // Act
    process?.assignments[0]?.resolve("resumed");
    await recovered.wait({ targets: ["saved-id"], timeoutMs: 1_000 });
    const closed = await recovered.close("saved-id");

    // Assert
    expect(closed.status).toBe("closed");
    await expect(recovered.followup({ target: "saved-id", message: "again" })).rejects.toMatchObject({
      kind: "closed",
    });
    expect(fake.entries.map((entry) => entry.event)).toContain("mail_queued");
    expect(fake.entries.map((entry) => entry.event)).toContain("mail_delivered");
    expect(fake.entries).toContainEqual(expect.objectContaining({ event: "started", generation: 3 }));
    expect(fake.entries).toContainEqual(expect.objectContaining({ event: "completed", generation: 3 }));
    expect(fake.entries.at(-1)?.event).toBe("closed");
  });

  test("waits for any or all exact assignment snapshots and aborts only the wait", async () => {
    // Arrange
    const fake = harness();
    const first = await fake.supervisor.spawn({ taskName: "one", agentType: "worker", prompt: "one", execution });
    const second = await fake.supervisor.spawn({ taskName: "two", agentType: "worker", prompt: "two", execution });
    fake.processes.get(first.agentPath)?.assignments[0]?.resolve("one done");

    // Act
    const any = await fake.supervisor.wait({
      targets: [first.agentId, second.agentPath],
      condition: "any",
      timeoutMs: 1_000,
    });
    const timedOut = await fake.supervisor.wait({ targets: [second.agentId], timeoutMs: 0 });
    const controller = new AbortController();
    controller.abort(new Error("cancel wait"));
    const aborted = fake.supervisor.wait({ targets: [second.agentId], signal: controller.signal });

    // Assert
    expect(any.completed.map((item) => item.assignmentId)).toEqual([first.assignmentId]);
    expect(any.pending.map((item) => item.assignmentId)).toEqual([second.assignmentId]);
    expect(timedOut).toMatchObject({ timedOut: true, completed: [] });
    await expect(aborted).rejects.toThrow("cancel wait");
    expect(fake.processes.get(second.agentPath)?.interrupt).not.toHaveBeenCalled();

    // Act
    fake.processes.get(second.agentPath)?.assignments[0]?.resolve("two done");
    const all = await fake.supervisor.wait({ targets: [first.agentId, second.agentId], condition: "all" });

    // Assert
    expect(all.timedOut).toBe(false);
    expect(all.completed).toHaveLength(2);
  });

  test("makes close idempotent after settlement", async () => {
    // Arrange
    const fake = harness();
    const spawned = await fake.supervisor.spawn({
      taskName: "closable",
      agentType: "worker",
      prompt: "work",
      execution,
    });
    fake.processes.get(spawned.agentPath)?.assignments[0]?.resolve("done");
    await fake.supervisor.wait({ targets: [spawned.agentPath], timeoutMs: 1_000 });

    // Act
    const first = await fake.supervisor.close(spawned.agentPath);
    const second = await fake.supervisor.close(spawned.agentId);

    // Assert
    expect(first.status).toBe("closed");
    expect(second.status).toBe("closed");
    expect(fake.processes.get(spawned.agentPath)?.close).toHaveBeenCalledTimes(1);
  });

  test("returns a typed failed settlement when completion artifact storage fails", async () => {
    // Arrange
    const fake = harness();
    fake.runtime.artifacts.write = mock(async () => {
      throw new Error("disk unavailable");
    });
    const spawned = await fake.supervisor.spawn({
      taskName: "artifact",
      agentType: "worker",
      prompt: "work",
      execution,
    });

    // Act
    fake.processes.get(spawned.agentPath)?.assignments[0]?.resolve("complete output");
    const waited = await fake.supervisor.wait({ targets: [spawned.agentId], timeoutMs: 1_000 });

    // Assert
    expect(waited.completed[0]).toMatchObject({
      outcome: "failed",
      errorKind: "artifact_write_failed",
      outputPreview: expect.stringContaining("complete output"),
    });
    expect(waited.completed[0]?.artifactReference).toBeUndefined();
    const notification = fake.deliverRootCompletion.mock.calls[0]?.[0];
    expect(notification).toMatchObject({
      status: "failed",
      outputPreview: expect.stringContaining("complete output"),
    });
    expect(notification).not.toHaveProperty("artifactReference");
    expect(fake.entries.at(-1)).toMatchObject({
      event: "failed",
      generation: 1,
      errorKind: "artifact_write_failed",
    });
  });

  test("notifies the parent with a bounded generic handoff when runtime and failure-artifact storage both fail", async () => {
    // Arrange
    const fake = harness();
    fake.runtime.artifacts.write = mock(async () => {
      throw new Error("disk unavailable");
    });
    const spawned = await fake.supervisor.spawn({
      taskName: "double-failure",
      agentType: "worker",
      prompt: "work",
      execution,
    });

    // Act
    fake.processes.get(spawned.agentPath)?.assignments[0]?.reject(new Error("runtime failed"));
    const waited = await fake.supervisor.wait({ targets: [spawned.agentId], timeoutMs: 1_000 });

    // Assert
    expect(waited.completed[0]).toMatchObject({
      outcome: "failed",
      errorKind: "artifact_write_failed",
      outputPreview: expect.stringContaining("Durable failure artifact unavailable"),
    });
    expect(waited.completed[0]?.artifactReference).toBeUndefined();
    expect(fake.deliverRootCompletion).toHaveBeenCalledTimes(1);
    expect(fake.deliverRootCompletion.mock.calls[0]?.[0]).not.toHaveProperty("artifactReference");
  });

  test("preserves typed artifact_too_large settlement behavior", async () => {
    // Arrange
    const fake = harness();
    fake.runtime.artifacts.write = mock(async () => {
      throw new ArtifactTooLargeError(MAX_ARTIFACT_BYTES + 1);
    });
    const spawned = await fake.supervisor.spawn({
      taskName: "oversized",
      agentType: "worker",
      prompt: "work",
      execution,
    });

    // Act
    fake.processes.get(spawned.agentPath)?.assignments[0]?.resolve("oversized output");
    const waited = await fake.supervisor.wait({ targets: [spawned.agentId], timeoutMs: 1_000 });

    // Assert
    expect(waited.completed[0]).toMatchObject({ outcome: "failed", errorKind: "artifact_too_large" });
  });

  test("restores and spawns beyond the retired lifetime agent cap", async () => {
    // Arrange
    const fake = harness();
    const retiredLifetimeCap = 100;
    await fake.supervisor.restore(
      Array.from({ length: retiredLifetimeCap + 1 }, (_, index) => ({
        agentPath: `/root/saved-${index}`,
        agentId: `saved-${index}`,
        agentType: "worker",
        sessionFile: `/sessions/saved-${index}.jsonl`,
        execution,
        assignmentGeneration: 0,
        queuedMailIds: [],
        status: "closed" as const,
      })),
    );

    // Act
    await fake.supervisor.spawn({
      taskName: "more",
      agentType: "worker",
      prompt: "work",
      execution,
    });

    // Assert
    expect(await fake.supervisor.list()).toHaveLength(retiredLifetimeCap + 2);
  });

  test("persists startup failure with the queued assignment generation", async () => {
    // Arrange
    const fake = harness();
    const process = createFakeProcess("/root/start-failure");
    process.startup.mockRejectedValue(new Error("startup failed"));
    fake.runtime.createProcess = mock(() => process);

    // Act
    const spawning = fake.supervisor.spawn({
      taskName: "start-failure",
      agentType: "worker",
      prompt: "work",
      execution,
    });

    // Assert
    await expect(spawning).rejects.toThrow("startup failed");
    expect(fake.entries.at(-1)).toMatchObject({
      event: "failed",
      generation: 1,
      errorKind: "start_failed",
    });
  });

  test("redacts authoritative output before artifacts, previews, journal, and root delivery", async () => {
    // Arrange
    const secret = "provider-token-sentinel-123";
    const fake = harness({ redact: (value) => value.replaceAll(secret, "[REDACTED]") });
    const spawned = await fake.supervisor.spawn({
      taskName: "redacted",
      agentType: "worker",
      prompt: "Produce output",
      execution,
    });
    const process = fake.processes.get(spawned.agentPath);

    // Act
    process?.assignments[0]?.resolve(`normal output ${secret}`);
    const waited = await fake.supervisor.wait({ targets: [spawned.agentId], timeoutMs: 1_000 });
    await flush();

    // Assert
    const sinks = JSON.stringify({
      artifacts: [...fake.artifactContents.values()],
      entries: fake.entries,
      root: fake.deliverRootCompletion.mock.calls,
      waited,
    });
    expect(sinks).toContain("normal output");
    expect(sinks).toContain("[REDACTED]");
    expect(sinks).not.toContain(secret);
  });

  test("delivers one typed root completion per assignment generation", async () => {
    // Arrange
    const fake = harness();
    const spawned = await fake.supervisor.spawn({
      taskName: "root-answer",
      agentType: "worker",
      prompt: "private prompt",
      execution,
    });
    const childSettlement = fake.processes.get(spawned.agentPath)?.assignments[0];

    // Act
    childSettlement?.resolve("final answer");
    childSettlement?.resolve("duplicate settlement");
    const waited = await fake.supervisor.wait({ targets: [spawned.agentPath], timeoutMs: 1_000 });

    // Assert
    expect(fake.deliverRootCompletion).toHaveBeenCalledTimes(1);
    const notification = fake.deliverRootCompletion.mock.calls[0]?.[0];
    expect(notification).toMatchObject({
      messageType: "FINAL_ANSWER",
      agentPath: "/root/root-answer",
      agentId: "agent-1",
      parentPath: "/root",
      assignmentId: "agent-1:1",
      generation: 1,
      status: "completed",
      execution,
    });
    expect(notification?.artifactReference).toStartWith("subagent-artifact:");
    expect(notification?.outputPreview).toStartWith("final answer");
    expect(waited.completed[0]?.notification).toEqual({ status: "delivered", delivery: "root" });
    expect(JSON.stringify(fake.deliverRootCompletion.mock.calls)).not.toContain("private prompt");
    expect(fake.entries[0]).toMatchObject({ event: "spawned", execution });
  });

  test("steers final answer only to the exact running direct parent", async () => {
    // Arrange
    const fake = harness();
    const parent = await fake.supervisor.spawn({
      taskName: "parent",
      agentType: "worker",
      prompt: "parent work",
      execution,
    });
    const sibling = await fake.supervisor.spawn({
      taskName: "sibling",
      agentType: "worker",
      prompt: "sibling work",
      execution,
    });
    const child = await fake.supervisor.spawn({
      parentPath: parent.agentPath,
      taskName: "child",
      agentType: "worker",
      prompt: "child work",
      execution: strongerExecution,
    });

    // Act
    fake.processes.get(child.agentPath)?.assignments[0]?.resolve("child answer");
    const waited = await fake.supervisor.wait({ targets: [child.agentPath], timeoutMs: 1_000 });

    // Assert
    const parentSend = fake.processes.get(parent.agentPath)?.send;
    expect(parentSend).toHaveBeenCalledTimes(1);
    expect(parentSend?.mock.calls[0]?.[0]).toStartWith("Message Type: FINAL_ANSWER\n");
    expect(parentSend?.mock.calls[0]?.[0]).toContain("Sender: /root/parent/child");
    expect(parentSend?.mock.calls[0]?.[0]).not.toContain(child.assignmentId);
    expect(fake.processes.get(sibling.agentPath)?.send).not.toHaveBeenCalled();
    expect(fake.deliverRootCompletion).not.toHaveBeenCalled();
    expect(waited.completed[0]?.notification).toEqual({ status: "delivered", delivery: "steered" });
  });

  test("queues a durable final answer for an idle direct parent and delivers it only when resumed", async () => {
    // Arrange
    const fake = harness();
    const parent = await fake.supervisor.spawn({
      taskName: "idle-parent",
      agentType: "worker",
      prompt: "parent work",
      execution,
    });
    fake.processes.get(parent.agentPath)?.assignments[0]?.resolve("parent done");
    await fake.supervisor.wait({ targets: [parent.agentPath], timeoutMs: 1_000 });
    const child = await fake.supervisor.spawn({
      parentPath: parent.agentPath,
      taskName: "child",
      agentType: "worker",
      prompt: "child work",
      execution,
    });
    const parentProcess = fake.processes.get(parent.agentPath);

    // Act
    fake.processes.get(child.agentPath)?.assignments[0]?.resolve("nested answer");
    const waited = await fake.supervisor.wait({ targets: [child.agentPath], timeoutMs: 1_000 });

    // Assert
    expect(waited.completed[0]?.notification).toMatchObject({ status: "delivered", delivery: "queued" });
    expect(parentProcess?.send).not.toHaveBeenCalled();
    expect(fake.entries).toContainEqual(
      expect.objectContaining({ event: "mail_queued", agentPath: parent.agentPath, agentId: parent.agentId }),
    );
    expect([...fake.artifactContents.values()].some((content) => content.includes("Message Type: FINAL_ANSWER"))).toBe(
      true,
    );

    // Act
    await fake.supervisor.followup({ target: parent.agentPath, message: "resume parent" });
    await flush();

    // Assert
    expect(parentProcess?.send).toHaveBeenCalledTimes(1);
    expect(parentProcess?.send.mock.calls[0]?.[0]).toStartWith("Message Type: FINAL_ANSWER\n");
  });

  test("queues nested completion for an unloaded parent without starting a parent assignment", async () => {
    // Arrange
    const fake = harness();
    await fake.supervisor.restore([
      {
        agentPath: "/root/unloaded-parent",
        agentId: "saved-parent",
        agentType: "worker",
        sessionFile: "/sessions/saved-parent.jsonl",
        execution,
        assignmentGeneration: 2,
        queuedMailIds: [],
      },
    ]);
    const child = await fake.supervisor.spawn({
      parentPath: "/root/unloaded-parent",
      taskName: "child",
      agentType: "worker",
      prompt: "nested work",
      execution,
    });

    // Act
    fake.processes.get(child.agentPath)?.assignments[0]?.resolve("nested answer");
    const waited = await fake.supervisor.wait({ targets: [child.agentPath], timeoutMs: 1_000 });

    // Assert
    expect(waited.completed[0]?.notification).toMatchObject({ status: "delivered", delivery: "queued" });
    expect(fake.processes.has("/root/unloaded-parent")).toBe(false);
    expect(
      (await fake.supervisor.list()).find((agent) => agent.agentId === "saved-parent")?.assignment,
    ).toBeUndefined();
  });

  test("reports root notification failure without changing completed wait state", async () => {
    // Arrange
    const fake = harness();
    fake.deliverRootCompletion.mockRejectedValue(new Error("boundary unavailable"));
    const spawned = await fake.supervisor.spawn({
      taskName: "failed-notice",
      agentType: "worker",
      prompt: "work",
      execution,
    });

    // Act
    fake.processes.get(spawned.agentPath)?.assignments[0]?.resolve("completed output");
    const waited = await fake.supervisor.wait({ targets: [spawned.agentPath], timeoutMs: 1_000 });

    // Assert
    expect(waited.completed[0]).toMatchObject({
      outcome: "completed",
      notification: {
        status: "failed",
        failure: { kind: "root_callback_failed", targetPath: "/root", retryable: true },
      },
    });
    expect(waited.completed[0]?.artifactReference).toStartWith("subagent-artifact:");
    expect((await fake.supervisor.list())[0]?.status).toBe("idle");
    expect(fake.entries.at(-1)?.event).toBe("completed");
  });

  test("keeps close race-safe while root completion callback is in flight", async () => {
    // Arrange
    const fake = harness();
    const delivery = Promise.withResolvers<void>();
    fake.deliverRootCompletion.mockImplementation(async () => await delivery.promise);
    const spawned = await fake.supervisor.spawn({
      taskName: "close-race",
      agentType: "worker",
      prompt: "work",
      execution,
    });

    // Act
    fake.processes.get(spawned.agentPath)?.assignments[0]?.resolve("answer");
    await flush();
    const closing = fake.supervisor.close(spawned.agentPath);
    delivery.resolve();
    const closed = await closing;

    // Assert
    expect(closed.status).toBe("closed");
    expect(fake.deliverRootCompletion).toHaveBeenCalledTimes(1);
    expect(fake.entries).toContainEqual(expect.objectContaining({ event: "completed", generation: 1 }));
    expect(fake.entries.at(-1)?.event).toBe("closed");
  });

  test("settles shutdown safely when root notification delivery fails concurrently", async () => {
    // Arrange
    const fake = harness();
    fake.deliverRootCompletion.mockRejectedValue(new Error("root closed"));
    const spawned = await fake.supervisor.spawn({
      taskName: "shutdown-race",
      agentType: "worker",
      prompt: "work",
      execution,
    });

    // Act
    const shutdown = fake.supervisor.shutdown();
    fake.processes.get(spawned.agentPath)?.assignments[0]?.resolve("late answer");

    // Assert
    await expect(shutdown).resolves.toBeUndefined();
    expect(fake.deliverRootCompletion).toHaveBeenCalledTimes(1);
    expect(fake.entries).toContainEqual(expect.objectContaining({ event: "interrupted", generation: 1 }));
  });

  test("does not classify an unrelated rejection as interrupted when abort RPC was not acknowledged", async () => {
    // Arrange
    const fake = harness();
    const spawned = await fake.supervisor.spawn({
      taskName: "abort-rejected",
      agentType: "worker",
      prompt: "work",
      execution,
    });
    const process = fake.processes.get(spawned.agentPath);
    process?.interrupt.mockRejectedValue(new Error("abort RPC failed before acknowledgement"));

    // Act
    const interrupt = fake.supervisor.interrupt(spawned.agentId);
    await expect(interrupt).rejects.toThrow("abort RPC failed before acknowledgement");
    process?.assignments[0]?.reject(new Error("unrelated process exit"));
    const waited = await fake.supervisor.wait({ targets: [spawned.agentId], timeoutMs: 1_000 });

    // Assert
    expect(waited.completed[0]).toMatchObject({ outcome: "failed", errorKind: "runtime_failure" });
    expect(fake.entries.at(-1)).toMatchObject({ event: "failed", generation: 1 });
  });

  test("returns from interrupt only after authoritative settlement and cleanup", async () => {
    // Arrange
    const fake = harness();
    const spawned = await fake.supervisor.spawn({
      taskName: "interruptible",
      agentType: "worker",
      prompt: "work",
      execution,
    });
    const process = fake.processes.get(spawned.agentPath);

    // Act
    const interrupted = fake.supervisor.interrupt(spawned.agentId);
    await flush();
    let returned = false;
    void interrupted.then(() => {
      returned = true;
    });
    await flush();
    const returnedBeforeSettlement = returned;
    process?.assignments[0]?.reject(new Error("Pi aborted the active turn"));
    const result = await interrupted;

    // Assert
    expect(returnedBeforeSettlement).toBe(false);
    expect(process?.interrupt).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("interrupted");
    expect(result.assignment?.phase).toBe("settled");
    expect(fake.entries.at(-1)).toMatchObject({ event: "interrupted", generation: 1 });
  });

  test("returns the exact interrupted generation when a queued follow-up starts concurrently", async () => {
    // Arrange
    const fake = harness();
    const spawned = await fake.supervisor.spawn({
      taskName: "interrupt-with-queue",
      agentType: "worker",
      prompt: "first",
      execution,
    });
    const process = fake.processes.get(spawned.agentPath);
    await fake.supervisor.followup({ target: spawned.agentId, message: "second", execution });

    // Act
    const interrupted = fake.supervisor.interrupt(spawned.agentId);
    await flush();
    process?.assignments[0]?.reject(new Error("Pi aborted generation one"));
    const result = await interrupted;
    for (let attempt = 0; attempt < 10 && process?.assignments.length === 1; attempt += 1) await flush();
    const current = (await fake.supervisor.list())[0];

    // Assert
    expect(result).toMatchObject({
      status: "interrupted",
      assignment: { id: "agent-1:1", generation: 1, phase: "settled" },
    });
    expect(current).toMatchObject({ assignment: { id: "agent-1:2", generation: 2 } });
    process?.assignments[1]?.resolve("second done");
    await fake.supervisor.wait({ targets: [spawned.agentId], timeoutMs: 1_000 });
  });
});
