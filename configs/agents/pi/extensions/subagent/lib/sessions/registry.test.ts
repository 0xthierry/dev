import { describe, expect, test } from "bun:test";
import { findAgentSessionRecord, restoreAgentSessionRecords } from "./registry";

describe("restoreAgentSessionRecords", () => {
  test("restores child agent session metadata from prior agent tool results on the branch", () => {
    // Arrange
    const entries = [
      {
        type: "message",
        message: {
          role: "toolResult",
          toolName: "agent",
          details: {
            results: [
              {
                agentId: "019e1882-8bc8-767c-a1e6-d7c9ebd3a574",
                agent: "explorer",
                sessionFile: "/agent-sessions/session.jsonl",
                task: "Find auth files",
              },
            ],
          },
        },
      },
    ];

    // Act
    const records = restoreAgentSessionRecords(entries);

    // Assert
    expect(records).toEqual([
      {
        agentId: "019e1882-8bc8-767c-a1e6-d7c9ebd3a574",
        agent: "explorer",
        sessionFile: "/agent-sessions/session.jsonl",
        task: "Find auth files",
      },
    ]);
  });

  test("restores legacy capitalized Agent tool results", () => {
    // Arrange
    const entries = [agentEntry("019e", "explorer", "/old-agent-tool.jsonl", "Legacy", "Agent")];

    // Act
    const records = restoreAgentSessionRecords(entries);

    // Assert
    expect(records).toEqual([
      { agentId: "019e", agent: "explorer", sessionFile: "/old-agent-tool.jsonl", task: "Legacy" },
    ]);
  });

  test("keeps the latest record for an agent session id", () => {
    // Arrange
    const entries = [
      agentEntry("019e", "explorer", "/old.jsonl", "First"),
      agentEntry("019e", "explorer", "/new.jsonl", "Second"),
    ];

    // Act
    const records = restoreAgentSessionRecords(entries);

    // Assert
    expect(records).toEqual([{ agentId: "019e", agent: "explorer", sessionFile: "/new.jsonl", task: "Second" }]);
  });
});

describe("findAgentSessionRecord", () => {
  test("finds a record by unique id prefix", () => {
    // Arrange
    const records = [
      { agentId: "019e1882-aaaa", agent: "explorer", sessionFile: "/a.jsonl" },
      { agentId: "019e1883-bbbb", agent: "worker", sessionFile: "/b.jsonl" },
    ];

    // Act
    const result = findAgentSessionRecord(records, "019e1883");

    // Assert
    expect(result).toEqual({ ok: true, record: records[1] });
  });

  test("reports ambiguous id prefixes", () => {
    // Arrange
    const records = [
      { agentId: "019e1882-aaaa", agent: "explorer", sessionFile: "/a.jsonl" },
      { agentId: "019e1882-bbbb", agent: "worker", sessionFile: "/b.jsonl" },
    ];

    // Act
    const result = findAgentSessionRecord(records, "019e1882");

    // Assert
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("ambiguous");
      expect(result.matches).toHaveLength(2);
    }
  });
});

function agentEntry(agentId: string, agent: string, sessionFile: string, task: string, toolName = "agent"): unknown {
  return {
    type: "message",
    message: {
      role: "toolResult",
      toolName,
      details: { results: [{ agentId, agent, sessionFile, task }] },
    },
  };
}
