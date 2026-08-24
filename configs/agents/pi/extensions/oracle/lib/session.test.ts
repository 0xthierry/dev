import { describe, expect, test } from "bun:test";
import { isOracleSessionStateCompatible, restoreOracleSessionState } from "./session";

describe("restoreOracleSessionState", () => {
  test("restores the latest oracle state from tool results", () => {
    // Arrange
    const entries = [
      oracleEntry({ conversationId: "conversation-1", currentNode: "node-1", projectId: "g-p-one" }),
      oracleEntry({
        conversationId: "conversation-2",
        currentNode: "node-2",
        projectId: "g-p-one",
        model: "gpt-5-6-pro",
      }),
    ];

    // Act
    const result = restoreOracleSessionState(entries);

    // Assert
    expect(result).toEqual({
      conversationId: "conversation-2",
      currentNode: "node-2",
      projectId: "g-p-one",
      model: "gpt-5-6-pro",
    });
  });

  test("ignores failed or incomplete oracle results", () => {
    // Arrange
    const entries = [
      oracleEntry({ conversationId: "conversation-1", currentNode: "node-1" }),
      oracleEntry({ ok: false, conversationId: "conversation-2", currentNode: "node-2" }),
      oracleEntry({ conversationId: "conversation-3" }),
    ];

    // Act
    const result = restoreOracleSessionState(entries);

    // Assert
    expect(result).toEqual({ conversationId: "conversation-1", currentNode: "node-1" });
  });
});

describe("isOracleSessionStateCompatible", () => {
  test("matches states by project id", () => {
    // Arrange
    const projectState = { conversationId: "conversation", currentNode: "node", projectId: "g-p-one" };
    const rootState = { conversationId: "conversation", currentNode: "node" };

    // Act
    const projectMatch = isOracleSessionStateCompatible(projectState, "g-p-one");
    const projectMismatch = isOracleSessionStateCompatible(projectState, "g-p-two");
    const rootMatch = isOracleSessionStateCompatible(rootState, undefined);
    const rootMismatch = isOracleSessionStateCompatible(rootState, "g-p-one");

    // Assert
    expect(projectMatch).toBe(true);
    expect(projectMismatch).toBe(false);
    expect(rootMatch).toBe(true);
    expect(rootMismatch).toBe(false);
  });
});

function oracleEntry(details: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "message",
    message: {
      role: "toolResult",
      toolName: "oracle",
      details: { ok: true, ...details },
    },
  };
}
