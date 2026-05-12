import { describe, expect, test } from "bun:test";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import registerSubagentChildRuntime, { stripParentAgentMessages } from "./child-runtime";

describe("stripParentAgentMessages", () => {
  test("removes parent agent tool results from inherited child context", () => {
    // Arrange
    const messages = [
      { role: "user", content: [{ type: "text", text: "Keep me" }] },
      { role: "toolResult", toolName: "agent", content: [{ type: "text", text: "large subagent output" }] },
      { role: "toolResult", toolName: "read", content: [{ type: "text", text: "keep read output" }] },
    ];

    // Act
    const result = stripParentAgentMessages(messages);

    // Assert
    expect(result).toEqual([
      { role: "user", content: [{ type: "text", text: "Keep me" }] },
      { role: "toolResult", toolName: "read", content: [{ type: "text", text: "keep read output" }] },
    ]);
  });

  test("removes assistant agent tool-call blocks while preserving other content", () => {
    // Arrange
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will delegate." },
          { type: "toolCall", name: "agent", arguments: { subagent_type: "explorer", prompt: "Map code" } },
          { type: "toolCall", name: "bash", arguments: { command: "git status --short" } },
        ],
      },
      { role: "assistant", content: [{ type: "toolCall", name: "Agent", arguments: { prompt: "legacy" } }] },
    ];

    // Act
    const result = stripParentAgentMessages(messages);

    // Assert
    expect(result).toEqual([
      {
        role: "assistant",
        content: [
          { type: "text", text: "I will delegate." },
          { type: "toolCall", name: "bash", arguments: { command: "git status --short" } },
        ],
      },
    ]);
  });

  test("returns the original message array when no filtering is needed", () => {
    // Arrange
    const messages = [{ role: "user", content: [{ type: "text", text: "Keep me" }] }];

    // Act
    const result = stripParentAgentMessages(messages);

    // Assert
    expect(result).toBe(messages);
  });
});

describe("registerSubagentChildRuntime", () => {
  test("registers a context hook that filters parent agent messages", async () => {
    // Arrange
    const fakePi = createFakePi();
    registerSubagentChildRuntime(fakePi.pi);

    // Act
    const results = await fakePi.emit("context", {
      messages: [{ role: "toolResult", toolName: "agent", content: [{ type: "text", text: "large output" }] }],
    });

    // Assert
    expect(results).toEqual([{ messages: [] }]);
  });
});
