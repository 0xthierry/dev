import { afterEach, describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import type { BrowserUsePaths } from "./paths";
import type { BrowserUseHost } from "./register";
import { registerBrowserUseExtension } from "./register";
import type { BrowserUseRuntime } from "./runtime";

afterEach(() => {
  mock.clearAllMocks();
});

const paths: BrowserUsePaths = {
  available: true,
  nodeRepl: "/tmp/node_repl",
  node: "/tmp/node",
  nodeModules: "/tmp/node_modules",
  browserClient: "/tmp/browser-client.mjs",
  browserService: "/tmp/browser-service.mjs",
  codexHome: "/tmp/codex",
  codexCli: "/tmp/codex-cli",
};

function createRuntime(): BrowserUseRuntime {
  return {
    execute: mock(async () => ({ text: "ok", isError: false, content: [{ type: "text" as const, text: "ok" }] })),
    endTurn: mock(async () => undefined),
    close: mock(async () => undefined),
  };
}

function createHost(runtime: BrowserUseRuntime, available = true): BrowserUseHost {
  return {
    resolvePaths: mock(() => (available ? paths : { available: false as const, reason: "missing kernel" })),
    createRuntime: mock(() => runtime),
    skillRoot: mock(() => "/tmp/browser-use-skills"),
  };
}

describe("registerBrowserUseExtension", () => {
  test("keeps the tool visible but disabled by default without creating a runtime", async () => {
    // Arrange
    const fakePi = createFakePi();
    const host = createHost(createRuntime());
    registerBrowserUseExtension(fakePi.pi, host);

    // Act
    await fakePi.emit("session_start");
    await fakePi.runCommand("browser-use-status", "", { hasUI: true });

    // Assert
    expect(fakePi.tools.has("browser_use")).toBe(true);
    expect(fakePi.activeTools.has("browser_use")).toBe(true);
    await expect(fakePi.runTool("browser_use", { code: "must not execute" })).rejects.toThrow("disabled");
    expect(host.createRuntime).not.toHaveBeenCalled();
    expect(fakePi.uiNotifications[0]?.message).toContain('"enabled": false');
  });

  test("disabling closes once, blocks execution, and re-enabling creates a fresh runtime", async () => {
    // Arrange
    const fakePi = createFakePi();
    const first = createRuntime();
    const second = createRuntime();
    const host = createHost(first);
    host.createRuntime = mock<BrowserUseHost["createRuntime"]>().mockReturnValueOnce(first).mockReturnValue(second);
    registerBrowserUseExtension(fakePi.pi, host);

    // Act
    await fakePi.runCommand("browser-use", "on");
    await fakePi.runTool("browser_use", { code: "first" });
    await fakePi.runCommand("browser-use", "off");
    await fakePi.runCommand("browser-use", "off");

    // Assert
    expect(first.close).toHaveBeenCalledTimes(1);
    await expect(fakePi.runTool("browser_use", { code: "blocked" })).rejects.toThrow("disabled");
    expect(first.execute).toHaveBeenCalledTimes(1);
    expect(fakePi.tools.has("browser_use")).toBe(true);
    await fakePi.runCommand("browser-use", "on");
    await fakePi.runTool("browser_use", { code: "second" });
    expect(host.createRuntime).toHaveBeenCalledTimes(2);
    expect(second.execute).toHaveBeenCalledTimes(1);
    await fakePi.emit("session_shutdown");
    await expect(fakePi.runTool("browser_use", { code: "after shutdown" })).rejects.toThrow("disabled");
  });

  test("completes toggle arguments and rejects invalid modes without enabling", async () => {
    // Arrange
    const fakePi = createFakePi();
    const host = createHost(createRuntime());
    registerBrowserUseExtension(fakePi.pi, host);

    // Act
    const command = fakePi.commands.get("browser-use");
    const completions = command?.getArgumentCompletions?.("o");
    await fakePi.runCommand("browser-use", "always", { hasUI: true });
    await fakePi.runCommand("browser-use", "status", { hasUI: true });

    // Assert
    expect(completions).toEqual([
      { value: "on", label: "on" },
      { value: "off", label: "off" },
    ]);
    expect(fakePi.uiNotifications[0]?.message).toContain("Usage:");
    expect(fakePi.uiNotifications[1]?.message).toContain("off");
    expect(host.createRuntime).not.toHaveBeenCalled();
  });

  test("reports missing kernel without exposing browser_use", async () => {
    // Arrange
    const fakePi = createFakePi();
    const host = createHost(createRuntime(), false);

    // Act
    registerBrowserUseExtension(fakePi.pi, host);
    await fakePi.runCommand("browser-use-status", "", { hasUI: true });

    // Assert
    expect(host.createRuntime).not.toHaveBeenCalled();
    expect(fakePi.commands.has("browser-use-status")).toBe(true);
    expect(fakePi.tools.size).toBe(0);
    expect(fakePi.uiNotifications[0]?.type).toBe("warning");
    expect(fakePi.uiNotifications[0]?.message).toContain("missing kernel");
  });

  test("registers the status command and browser_use tool when the kernel exists", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = createRuntime();
    const host = createHost(runtime);

    // Act
    registerBrowserUseExtension(fakePi.pi, host);
    await fakePi.runCommand("browser-use-status", "", { hasUI: true });
    await fakePi.runCommand("browser-use", "on");
    const toolResult = await fakePi.runTool("browser_use", { code: "nodeRepl.write(1);" });
    await fakePi.emit("session_start");
    const discovered = await fakePi.emit("resources_discover");

    // Assert
    expect(host.createRuntime).toHaveBeenCalledTimes(1);
    expect(fakePi.tools.has("browser_use")).toBe(true);
    expect(runtime.execute).toHaveBeenCalledWith("nodeRepl.write(1);", undefined, expect.any(Function));
    expect(toolResult).toEqual({
      content: [{ type: "text", text: "ok" }],
      details: { isError: false },
    });
    expect(fakePi.activeTools.has("browser_use")).toBe(true);
    expect(discovered).toEqual([{ skillPaths: ["/tmp/browser-use-skills"] }]);
  });

  test("preserves images on errors and marks failure through Pi's result hook", async () => {
    // Arrange
    const fakePi = createFakePi();
    const image = { type: "image" as const, data: "AAAA", mimeType: "image/png" };
    const runtime: BrowserUseRuntime = {
      execute: mock(async (code) =>
        code === "image"
          ? { text: "", isError: false, content: [image] }
          : {
              text: "Execution failed",
              isError: true,
              content: [image, { type: "text" as const, text: "Execution failed" }],
            },
      ),
      endTurn: mock(async () => undefined),
      close: mock(async () => undefined),
    };
    registerBrowserUseExtension(fakePi.pi, createHost(runtime));

    // Act
    await fakePi.runCommand("browser-use", "on");
    const result = await fakePi.runTool("browser_use", { code: "image" });

    // Assert
    expect(result).toMatchObject({ content: [image] });
    const error = await fakePi.runTool("browser_use", { code: "error" });
    expect(error).toMatchObject({
      content: [image, { type: "text", text: "Execution failed" }],
      details: { isError: true },
    });
    expect(await fakePi.emit("tool_result", { toolName: "browser_use", details: { isError: true } })).toEqual([
      { isError: true },
    ]);
    expect(await fakePi.emit("tool_result", { toolName: "other_tool", details: { isError: true } })).toEqual([
      undefined,
    ]);
  });

  test("routes an origin permission request to Pi confirmation instead of auto-approving", async () => {
    // Arrange
    const fakePi = createFakePi();
    const confirm = mock(async () => true);
    const runtime: BrowserUseRuntime = {
      execute: mock<BrowserUseRuntime["execute"]>(async (_code, _signal, approve) => {
        const decision = await approve?.(
          {
            message: "Allow the test origin?",
            requestedSchema: { type: "object", properties: {} },
            _meta: { origin: "http://127.0.0.1:1234" },
          },
          new AbortController().signal,
        );
        return {
          text: decision?.action ?? "missing",
          isError: false,
          content: [{ type: "text", text: decision?.action ?? "missing" }],
        };
      }),
      endTurn: mock(async () => undefined),
      close: mock(async () => undefined),
    };
    registerBrowserUseExtension(fakePi.pi, createHost(runtime));

    // Act
    await fakePi.runCommand("browser-use", "on");
    const result = await fakePi.runTool("browser_use", { code: "test" }, { hasUI: true, ui: { confirm } });

    // Assert
    expect(confirm).toHaveBeenCalledWith(
      "Browser permission",
      expect.stringContaining("127.0.0.1:1234"),
      expect.any(Object),
    );
    expect(result).toMatchObject({ content: [{ type: "text", text: "accept" }] });
    const headless = await fakePi.runTool("browser_use", { code: "test" }, { hasUI: false });
    expect(headless).toMatchObject({ content: [{ type: "text", text: "cancel" }] });
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  test("does not register browser_use twice on the same Pi runtime", () => {
    // Arrange
    const fakePi = createFakePi();
    const first = createRuntime();
    const second = createRuntime();

    // Act
    registerBrowserUseExtension(fakePi.pi, createHost(first));
    registerBrowserUseExtension(fakePi.pi, createHost(second));

    // Assert
    expect(fakePi.tools.size).toBe(1);
    expect(first.execute).not.toHaveBeenCalled();
    expect(second.execute).not.toHaveBeenCalled();
    expect(second.close).not.toHaveBeenCalled();
  });

  test("keeps the kernel between turns and closes it on session shutdown", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = createRuntime();
    registerBrowserUseExtension(fakePi.pi, createHost(runtime));

    // Act
    await fakePi.runCommand("browser-use", "on");
    await fakePi.runTool("browser_use", { code: "const value = 1;" });
    await fakePi.emit("agent_settled");
    await fakePi.runTool("browser_use", { code: "nodeRepl.write(value);" });

    // Assert
    expect(runtime.execute).toHaveBeenCalledTimes(2);
    expect(runtime.close).not.toHaveBeenCalled();
    expect(runtime.endTurn).toHaveBeenCalledTimes(1);
    await fakePi.emit("session_shutdown");
    expect(runtime.close).toHaveBeenCalledTimes(1);
  });
});
