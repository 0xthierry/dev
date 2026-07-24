import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import type { OracleAnswer } from "./providers/chatgpt/direct";
import { registerOracle, registerOracleExtension } from "./register";
import type { OracleRuntime } from "./runtime";
import { ORACLE_TOOL_NAME } from "./tool";

describe("registerOracleExtension", () => {
  test("registers the oracle tool", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerOracleExtension(fakePi.pi);

    // Assert
    expect(fakePi.tools.has(ORACLE_TOOL_NAME)).toBe(true);
  });
});

describe("registerOracle", () => {
  test("wires the tool to the provided runtime", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime: OracleRuntime = {
      ask: mock(
        async (): Promise<OracleAnswer> => ({
          providerId: "chatgpt-web",
          providerLabel: "ChatGPT Web",
          model: "gpt-5-6-sol-pro",
          conversationId: "conversation-id",
          currentNode: "message-id",
          finished: true,
          resumed: false,
          text: "oracle answer",
        }),
      ),
    };
    registerOracle(fakePi.pi, runtime);

    // Act
    await fakePi.runTool(ORACLE_TOOL_NAME, { prompt: "ask the oracle" });

    // Assert
    expect(runtime.ask).toHaveBeenCalledWith({ prompt: "ask the oracle", signal: undefined });
  });
});
