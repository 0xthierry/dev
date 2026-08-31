import { describe, expect, test } from "bun:test";
import { recoverRuntimeMetadata } from "./recovery";

describe("recoverRuntimeMetadata", () => {
  test("replays the current branch into unloaded metadata with durable outcome references", () => {
    // Arrange
    const branch = [
      entry("spawned", {
        agentPath: "/root/review",
        agentId: "agent-1",
        agentType: "scout",
        sessionFile: "/sessions/agent-1.jsonl",
        execution: {
          profile: { provider: "openai", model: "gpt", effort: "medium" },
          source: { model: "agent", effort: "parent" },
        },
      }),
      entry("started", { agentPath: "/root/review", agentId: "agent-1", generation: 1 }),
      entry("execution_changed", {
        agentPath: "/root/review",
        agentId: "agent-1",
        execution: {
          profile: { provider: "xai", model: "grok", effort: "high" },
          source: { model: "invocation", effort: "repository" },
        },
      }),
      entry("completed", {
        agentPath: "/root/review",
        agentId: "agent-1",
        generation: 1,
        artifactReference: "subagent-artifact:0123456789abcdef0123456789abcdef",
        outputPreview: "Review complete.",
      }),
    ];

    // Act
    const recovered = recoverRuntimeMetadata(branch);

    // Assert
    expect(recovered).toEqual([
      {
        agentPath: "/root/review",
        agentId: "agent-1",
        agentType: "scout",
        sessionFile: "/sessions/agent-1.jsonl",
        execution: {
          profile: { provider: "xai", model: "grok", effort: "high" },
          source: { model: "invocation", effort: "repository" },
        },
        status: "unloaded",
        lastEvent: "completed",
        assignmentGeneration: 1,
        artifactReference: "subagent-artifact:0123456789abcdef0123456789abcdef",
        queuedMailIds: [],
      },
    ]);
  });

  test("keeps closed agents closed and reconstructs queued mail", () => {
    // Arrange
    const branch = [
      entry("spawned", {
        agentPath: "/root/worker",
        agentId: "agent-2",
        agentType: "worker",
        sessionFile: "/sessions/agent-2.jsonl",
        execution: {
          profile: { provider: "openai", model: "gpt", effort: "high" },
          source: { model: "agent", effort: "agent" },
        },
      }),
      entry("mail_queued", { agentPath: "/root/worker", agentId: "agent-2", mailId: "mail-b" }),
      entry("mail_queued", { agentPath: "/root/worker", agentId: "agent-2", mailId: "mail-a" }),
      entry("mail_delivered", { agentPath: "/root/worker", agentId: "agent-2", mailId: "mail-b" }),
      entry("closed", { agentPath: "/root/worker", agentId: "agent-2" }),
    ];

    // Act
    const recovered = recoverRuntimeMetadata(branch);

    // Assert
    expect(recovered[0]).toMatchObject({ status: "closed", lastEvent: "closed", queuedMailIds: ["mail-a"] });
  });

  test("ignores unrelated entries, pre-spawn transitions, and stale agent ids", () => {
    // Arrange
    const branch = [
      { type: "message", message: { role: "toolResult", toolName: "agent" } },
      entry("started", { agentPath: "/root/review", agentId: "missing", generation: 1 }),
      entry("spawned", {
        agentPath: "/root/review",
        agentId: "current",
        agentType: "scout",
        sessionFile: "/sessions/current.jsonl",
        execution: {
          profile: { provider: "openai", model: "gpt", effort: "low" },
          source: { model: "parent", effort: "parent" },
        },
      }),
      entry("closed", { agentPath: "/root/review", agentId: "stale" }),
    ];

    // Act
    const recovered = recoverRuntimeMetadata(branch);

    // Assert
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toMatchObject({
      agentId: "current",
      status: "unloaded",
      lastEvent: "spawned",
      assignmentGeneration: 0,
    });
  });

  test("restores the latest generation and ignores stale or post-settlement transitions", () => {
    // Arrange
    const branch = [
      spawned("/root/review", "agent-1"),
      entry("started", { agentPath: "/root/review", agentId: "agent-1", generation: 1 }),
      entry("completed", {
        agentPath: "/root/review",
        agentId: "agent-1",
        generation: 1,
        artifactReference: "subagent-artifact:first",
      }),
      entry("started", { agentPath: "/root/review", agentId: "agent-1", generation: 2 }),
      entry("failed", {
        agentPath: "/root/review",
        agentId: "agent-1",
        generation: 1,
        errorKind: "stale_failure",
      }),
      entry("interrupted", { agentPath: "/root/review", agentId: "agent-1", generation: 2 }),
      entry("started", { agentPath: "/root/review", agentId: "agent-1", generation: 2 }),
    ];

    // Act
    const recovered = recoverRuntimeMetadata(branch);

    // Assert
    expect(recovered[0]).toMatchObject({
      assignmentGeneration: 2,
      lastEvent: "interrupted",
    });
    expect(recovered[0]?.artifactReference).toBeUndefined();
    expect(recovered[0]?.failure).toBeUndefined();
  });

  test("keeps the latest failed assignment outcome across reload", () => {
    // Arrange
    const branch = [
      spawned("/root/worker", "agent-2"),
      entry("started", { agentPath: "/root/worker", agentId: "agent-2", generation: 4 }),
      entry("failed", {
        agentPath: "/root/worker",
        agentId: "agent-2",
        generation: 4,
        errorKind: "runtime_failure",
        artifactReference: "subagent-artifact:failure",
      }),
    ];

    // Act
    const recovered = recoverRuntimeMetadata(branch);

    // Assert
    expect(recovered[0]).toMatchObject({
      assignmentGeneration: 4,
      lastEvent: "failed",
      failure: { kind: "runtime_failure" },
      artifactReference: "subagent-artifact:failure",
    });
  });
});

function spawned(agentPath: string, agentId: string): unknown {
  return entry("spawned", {
    agentPath,
    agentId,
    agentType: "worker",
    sessionFile: `/sessions/${agentId}.jsonl`,
    execution: {
      profile: { provider: "openai", model: "gpt", effort: "high" },
      source: { model: "agent", effort: "repository" },
    },
  });
}

function entry(event: string, data: Record<string, unknown>): unknown {
  return { type: "custom", customType: "subagent-runtime", data: { version: 2, event, ...data } };
}
