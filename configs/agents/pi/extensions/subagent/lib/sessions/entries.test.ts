import { describe, expect, test } from "bun:test";
import {
  createRuntimeEntry,
  runtimeEntryFromSessionEntry,
  SUBAGENT_RUNTIME_ENTRY_TYPE,
  SUBAGENT_RUNTIME_ENTRY_VERSION,
} from "./entries";

describe("runtime journal entries", () => {
  test("reads a version-2 spawned entry from a Pi custom entry", () => {
    // Arrange
    const sessionEntry = {
      type: "custom",
      customType: SUBAGENT_RUNTIME_ENTRY_TYPE,
      data: {
        version: SUBAGENT_RUNTIME_ENTRY_VERSION,
        event: "spawned",
        agentPath: "/root/review",
        agentId: "agent-1",
        agentType: "scout",
        sessionFile: "/sessions/agent-1.jsonl",
        execution: {
          profile: { provider: "openai", model: "gpt", effort: "high" },
          source: { model: "agent", effort: "repository" },
        },
      },
    };

    // Act
    const entry = runtimeEntryFromSessionEntry(sessionEntry);

    // Assert
    expect(entry).toEqual({
      version: 2,
      event: "spawned",
      agentPath: "/root/review",
      agentId: "agent-1",
      agentType: "scout",
      sessionFile: "/sessions/agent-1.jsonl",
      execution: {
        profile: { provider: "openai", model: "gpt", effort: "high" },
        source: { model: "agent", effort: "repository" },
      },
    });
  });

  test("does not migrate legacy tool results or other journal versions", () => {
    // Arrange
    const entries = [
      { type: "message", message: { role: "toolResult", toolName: "agent", details: {} } },
      { type: "custom", customType: SUBAGENT_RUNTIME_ENTRY_TYPE, data: { version: 1, event: "spawned" } },
    ];

    // Act
    const results = entries.map(runtimeEntryFromSessionEntry);

    // Assert
    expect(results).toEqual([undefined, undefined]);
  });

  test("copies only the typed event shape and drops unknown sensitive fields", () => {
    // Arrange
    const unsafe = {
      version: 2,
      event: "started",
      agentPath: "/root/review",
      agentId: "agent-1",
      generation: 3,
      token: "secret",
      headers: { authorization: "secret" },
      prompt: "raw prompt",
    } as never;

    // Act
    const entry = createRuntimeEntry(unsafe);

    // Assert
    expect(entry).toEqual({
      version: 2,
      event: "started",
      agentPath: "/root/review",
      agentId: "agent-1",
      generation: 3,
    });
  });

  test("validates execution sources and excludes unknown execution metadata", () => {
    // Arrange
    const base = {
      version: 2 as const,
      event: "execution_changed" as const,
      agentPath: "/root/review",
      agentId: "agent-1",
    };
    const valid = {
      ...base,
      execution: {
        profile: { provider: "openai", model: "gpt", effort: "minimal", apiKey: "secret" },
        source: { model: "invocation", effort: "parent", token: "secret" },
        authorization: "secret",
      },
    };
    const invalid = ["default", "config", "", 1].map((source) => ({
      ...base,
      execution: {
        profile: { provider: "openai", model: "gpt", effort: "high" },
        source: { model: source, effort: "parent" },
      },
    }));

    // Act
    const parsedValid = createRuntimeEntry(valid as never);
    const parsedInvalid = invalid.map((data) =>
      runtimeEntryFromSessionEntry({ type: "custom", customType: SUBAGENT_RUNTIME_ENTRY_TYPE, data }),
    );

    // Assert
    expect(parsedValid).toEqual({
      ...base,
      execution: {
        profile: { provider: "openai", model: "gpt", effort: "minimal" },
        source: { model: "invocation", effort: "parent" },
      },
    });
    expect(parsedInvalid).toEqual([undefined, undefined, undefined, undefined]);
    expect(JSON.stringify(parsedValid)).not.toContain("secret");
  });

  test("rejects malformed generations on every assignment transition", () => {
    // Arrange
    const events = [
      { event: "started" },
      { event: "completed", artifactReference: "subagent-artifact:abc" },
      { event: "interrupted" },
      { event: "failed", errorKind: "runtime_failure" },
    ];
    const invalidGenerations = [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1"];

    // Act
    const parsed = events.flatMap((event) =>
      invalidGenerations.map((generation) =>
        runtimeEntryFromSessionEntry({
          type: "custom",
          customType: SUBAGENT_RUNTIME_ENTRY_TYPE,
          data: {
            version: 2,
            agentPath: "/root/review",
            agentId: "agent-1",
            generation,
            ...event,
          },
        }),
      ),
    );

    // Assert
    expect(parsed.every((entry) => entry === undefined)).toBe(true);
  });

  test("strips child-authored completion previews from the durable journal schema", () => {
    // Arrange
    const sessionEntry = {
      type: "custom",
      customType: SUBAGENT_RUNTIME_ENTRY_TYPE,
      data: {
        version: 2,
        event: "completed",
        agentPath: "/root/review",
        agentId: "agent-1",
        generation: 1,
        artifactReference: "subagent-artifact:abc",
        outputPreview: "sensitive child-authored preview",
      },
    };

    // Act
    const entry = runtimeEntryFromSessionEntry(sessionEntry);

    // Assert
    expect(entry).toEqual({
      version: 2,
      event: "completed",
      agentPath: "/root/review",
      agentId: "agent-1",
      generation: 1,
      artifactReference: "subagent-artifact:abc",
    });
  });
});
