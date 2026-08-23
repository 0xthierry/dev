import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DirectBrokerResult } from "./direct-broker";
import { DirectSessionExecutor } from "./session-executor";

const roots: string[] = [];

afterEach(async () => {
  mock.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function brokerResult(text: string, isError = false): DirectBrokerResult {
  return {
    content: [{ type: "text", text }],
    isError,
    brokerVersion: "test",
    clientBuild: "test",
    elicitationRequests: 0,
    modelTurnsStarted: 0,
    ephemeralThread: true,
    brokerCleanupVerified: false,
  };
}

describe("DirectSessionExecutor", () => {
  test("retains one official session across inspection and subsequent actions", async () => {
    // Arrange
    const root = await mkdtemp(path.join(os.tmpdir(), "direct-session-retained."));
    roots.push(root);
    const call = mock(async (method: string) => brokerResult(method));
    const close = mock(async () => undefined);
    const createSession = mock(async () => ({ call, close }));
    const executor = new DirectSessionExecutor({ createSession });

    // Act
    await executor.execute("get_app_state", { app: "Chrome" }, { stateRoot: root });
    await executor.execute("click", { app: "Chrome", x: 10, y: 10 }, { stateRoot: root });
    await executor.execute("type_text", { app: "Chrome", text: "hello" }, { stateRoot: root });
    await executor.close();

    // Assert
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(call.mock.calls.map((entry) => entry[0])).toEqual(["get_app_state", "click", "type_text"]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("advertises only the invoking caller's form-elicitation capability", async () => {
    // Arrange
    const root = await mkdtemp(path.join(os.tmpdir(), "direct-session-capability."));
    roots.push(root);
    const call = mock(async () => brokerResult("state"));
    const close = mock(async () => undefined);
    const createSession = mock(async () => ({ call, close }));
    const executor = new DirectSessionExecutor({ createSession });

    // Act
    await executor.execute(
      "get_app_state",
      { app: "TextEdit" },
      {
        stateRoot: root,
        supportsOpenAiFormElicitation: true,
      },
    );
    await executor.close();

    // Assert
    expect(createSession).toHaveBeenCalledWith({ supportsOpenAiFormElicitation: true });
  });

  test("closes a retained session when the official tool returns an error", async () => {
    // Arrange
    const root = await mkdtemp(path.join(os.tmpdir(), "direct-session-error."));
    roots.push(root);
    const call = mock(async () => brokerResult("denied", true));
    const close = mock(async () => undefined);
    const createSession = mock(async () => ({ call, close }));
    const executor = new DirectSessionExecutor({ createSession });

    // Act
    const response = await executor.execute("get_app_state", { app: "TextEdit" }, { stateRoot: root });

    // Assert
    expect(response.isError).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });
});
