import { describe, expect, mock, test } from "bun:test";
import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createFakePi } from "../../_shared/testing/fake-pi";
import type { OracleAnswer } from "./providers/chatgpt/direct";
import type { OracleRuntime } from "./runtime";
import {
  executeOracleTool,
  ORACLE_TOOL_NAME,
  OracleRequestError,
  type OracleToolDetails,
  registerOracleTool,
} from "./tool";

type ToolResult = AgentToolResult<OracleToolDetails>;

describe("registerOracleTool", () => {
  test("registers oracle with state-of-the-art guidance and only prompt/session parameters", () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = fakeRuntime();

    // Act
    registerOracleTool(fakePi.pi, runtime);

    // Assert
    const tool = fakePi.tools.get(ORACLE_TOOL_NAME);
    expect(tool?.description).toContain("state-of-the-art intelligence");
    expect(tool?.description).toContain("blind and stateless");
    expect(tool?.promptGuidelines).toContain(
      "oracle: The Oracle is a separate, state-of-the-art intelligence. Consult it when you are stuck, blocked, or low-confidence on hard reasoning, debugging, architecture, or review — or whenever the user asks for the Oracle or a second opinion.",
    );
    expect(JSON.stringify(tool?.parameters)).toContain("prompt");
    expect(JSON.stringify(tool?.parameters)).toContain("context");
    expect(JSON.stringify(tool?.parameters)).not.toContain("profile");
    expect(JSON.stringify(tool?.parameters)).not.toContain("browser");
    expect(JSON.stringify(tool?.parameters)).not.toContain("model");
  });

  test("returns an oracle answer through the provided runtime", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = fakeRuntime();
    registerOracleTool(fakePi.pi, runtime);

    // Act
    const result = (await fakePi.runTool(ORACLE_TOOL_NAME, { prompt: "Help with a hard bug." })) as ToolResult;

    // Assert
    expect(runtime.ask).toHaveBeenCalledWith({ prompt: "Help with a hard bug.", signal: undefined });
    expect(firstText(result)).toContain("The Oracle answered:");
    expect(firstText(result)).toContain("oracle answer");
    expect(result.details).toMatchObject({
      ok: true,
      providerId: "chatgpt-web",
      providerLabel: "ChatGPT Web",
      model: "gpt-5-5-pro",
      conversationId: "conversation-id",
      currentNode: "message-id",
      finished: true,
      context: "resume",
      resumed: false,
    });
  });
});

describe("executeOracleTool", () => {
  test("resumes the latest Oracle state from the Pi branch by default", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = fakeRuntime();
    const ctx = fakePi.createContext({
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "oracle",
              details: { ok: true, conversationId: "conversation-id", currentNode: "node-id" },
            },
          },
        ],
      },
    }) as unknown as ExtensionContext;

    // Act
    await executeOracleTool(runtime, { prompt: "follow up" }, undefined, ctx);

    // Assert
    expect(runtime.ask).toHaveBeenCalledWith({
      prompt: "follow up",
      signal: undefined,
      state: { conversationId: "conversation-id", currentNode: "node-id" },
    });
  });

  test("starts a fresh Oracle conversation when requested", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = fakeRuntime();
    const ctx = fakePi.createContext({
      sessionManager: {
        getBranch: () => [
          {
            type: "message",
            message: {
              role: "toolResult",
              toolName: "oracle",
              details: { ok: true, conversationId: "conversation-id", currentNode: "node-id" },
            },
          },
        ],
      },
    }) as unknown as ExtensionContext;

    // Act
    await executeOracleTool(runtime, { prompt: "new thread", context: "fresh" }, undefined, ctx);

    // Assert
    expect(runtime.ask).toHaveBeenCalledWith({ prompt: "new thread", signal: undefined });
  });

  test("throws a validation error without calling the runtime for an empty prompt", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = fakeRuntime();

    // Act
    const error = await executeOracleTool(
      runtime,
      { prompt: "   " },
      undefined,
      fakePi.createContext() as unknown as ExtensionContext,
    ).catch((thrown) => thrown);

    // Assert
    expect(error).toBeInstanceOf(OracleRequestError);
    expect((error as OracleRequestError).oracleError).toMatchObject({ code: "EMPTY_PROMPT" });
    expect(runtime.ask).not.toHaveBeenCalled();
  });

  test("throws an aborted error without calling the runtime", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = fakeRuntime();
    const controller = new AbortController();
    controller.abort();

    // Act
    const error = await executeOracleTool(
      runtime,
      { prompt: "ask" },
      controller.signal,
      fakePi.createContext() as unknown as ExtensionContext,
    ).catch((thrown) => thrown);

    // Assert
    expect(error).toBeInstanceOf(OracleRequestError);
    expect((error as OracleRequestError).oracleError).toMatchObject({ code: "ABORTED" });
    expect(runtime.ask).not.toHaveBeenCalled();
  });

  test("throws a request failure when ChatGPT Web fails", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = fakeRuntime();
    runtime.ask = mock(async () => {
      throw new Error("ChatGPT Web cookies were not found.");
    });

    // Act
    const error = await executeOracleTool(
      runtime,
      { prompt: "ask" },
      undefined,
      fakePi.createContext() as unknown as ExtensionContext,
    ).catch((thrown) => thrown);

    // Assert
    expect(error).toBeInstanceOf(OracleRequestError);
    expect((error as OracleRequestError).message).toBe("oracle failed: ChatGPT Web cookies were not found.");
    expect((error as OracleRequestError).oracleError).toMatchObject({ code: "REQUEST_FAILED" });
  });
});

function firstText(result: ToolResult): string | undefined {
  const item = result.content[0];
  return item?.type === "text" ? item.text : undefined;
}

function fakeRuntime(): OracleRuntime {
  return {
    ask: mock(
      async (): Promise<OracleAnswer> => ({
        providerId: "chatgpt-web",
        providerLabel: "ChatGPT Web",
        model: "gpt-5-5-pro",
        conversationId: "conversation-id",
        currentNode: "message-id",
        messageId: "message-id",
        status: "finished_successfully",
        finished: true,
        resumed: false,
        text: "oracle answer",
      }),
    ),
  };
}
