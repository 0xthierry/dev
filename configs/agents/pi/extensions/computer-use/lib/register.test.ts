import { afterEach, describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import type { ComputerUseCodeResult } from "./code/code-executor";
import { type ComputerUseHost, type ComputerUseRuntime, registerComputerUseExtension } from "./register";

afterEach(() => {
  mock.clearAllMocks();
});

function createRuntime(): ComputerUseRuntime {
  return {
    stateRoot: "/tmp/computer-use-test-state",
    codeExecutor: {
      execute: mock(
        async (): Promise<ComputerUseCodeResult> => ({
          content: [{ type: "text", text: "apps" }],
          calls: ["list_apps"],
        }),
      ),
      close: mock(async () => undefined),
    },
    getStatus: mock(() => ({
      stateRoot: "/tmp/computer-use-test-state",
      permissionMode: "no-permissions",
      brokerVerified: false,
      methods: ["list_apps"],
    })),
    openUrl: mock(async () => true),
  };
}

function createHost(runtime: ComputerUseRuntime, platform: NodeJS.Platform = "darwin"): ComputerUseHost {
  return {
    platform,
    createRuntime: mock(() => runtime),
  };
}

describe("registerComputerUseExtension", () => {
  test("reports unsupported platforms without exposing macOS computer control", async () => {
    // Arrange
    const fakePi = createFakePi();
    const host = createHost(createRuntime(), "linux");

    // Act
    registerComputerUseExtension(fakePi.pi, host);
    await fakePi.runCommand("computer-use-status", "", { hasUI: true });

    // Assert
    expect(host.createRuntime).not.toHaveBeenCalled();
    expect(fakePi.commands.has("computer-use-status")).toBe(true);
    expect(fakePi.tools.size).toBe(0);
    expect(fakePi.handlers.size).toBe(0);
    expect(fakePi.uiNotifications).toEqual([
      {
        message: "Computer Use is unavailable on linux; this extension requires macOS.",
        type: "warning",
      },
    ]);
  });

  test("registers the status command and composable tool on macOS", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = createRuntime();
    const host = createHost(runtime);

    // Act
    registerComputerUseExtension(fakePi.pi, host);
    await fakePi.runCommand("computer-use-status", "", { hasUI: true });
    const toolResult = await fakePi.runTool("computer_use", { code: "emit(await sky.list_apps());" });
    await fakePi.emit("session_start");

    // Assert
    expect(host.createRuntime).toHaveBeenCalledTimes(1);
    expect(fakePi.commands.has("computer-use-status")).toBe(true);
    expect(fakePi.tools.has("computer_use")).toBe(true);
    expect(runtime.getStatus).toHaveBeenCalledWith(runtime.stateRoot);
    expect(fakePi.uiNotifications[0]?.message).toContain('"permissionMode": "no-permissions"');
    expect(runtime.codeExecutor.execute).toHaveBeenCalledWith("emit(await sky.list_apps());", {
      stateRoot: runtime.stateRoot,
      signal: undefined,
      supportsOpenAiFormElicitation: true,
      onElicitation: expect.any(Function),
    });
    expect(toolResult).toEqual({
      content: [{ type: "text", text: "apps" }],
      details: { calls: ["list_apps"] },
    });
    expect(fakePi.activeTools.has("computer_use")).toBe(true);
  });

  test("closes the retained code executor when the agent settles or the session shuts down", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = createRuntime();
    registerComputerUseExtension(fakePi.pi, createHost(runtime));

    // Act
    await fakePi.emit("agent_settled");
    await fakePi.emit("session_shutdown");

    // Assert
    expect(runtime.codeExecutor.close).toHaveBeenCalledTimes(2);
  });
});
