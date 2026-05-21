import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { registerLsp, registerLspExtension } from "./register";
import type { LoadedLspRuntime, LspRuntime } from "./runtime";
import type { LspServerAdapter } from "./types";

describe("registerLspExtension", () => {
  test("registers the command, tools, and lifecycle handlers", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerLspExtension(fakePi.pi);

    // Assert
    expect(fakePi.commands.has("lsp")).toBe(true);
    expect(fakePi.tools.has("lsp_diagnostics")).toBe(true);
    expect(fakePi.tools.has("lsp_fix")).toBe(true);
    expect(fakePi.handlers.has("session_start")).toBe(true);
    expect(fakePi.handlers.has("session_shutdown")).toBe(true);
  });
});

describe("registerLsp", () => {
  test("shows lsp status through UI notifications", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: process.cwd() });
    const runtime = fakeRuntime({ adapters: [fakeAdapter("missing")], timeoutMs: 1000 });
    registerLsp(fakePi.pi, runtime);

    // Act
    await fakePi.runCommand("lsp", "", { hasUI: true });

    // Assert
    expect(runtime.load).toHaveBeenCalledWith(process.cwd());
    expect(fakePi.uiNotifications[0]?.message).toContain("missing LSP command: missing-lsp");
    expect(fakePi.uiNotifications[0]?.type).toBe("warning");
  });

  test("sends lsp status as a message when UI is unavailable", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: process.cwd() });
    const runtime = fakeRuntime({ adapters: [fakeAdapter("missing")], timeoutMs: 1000 });
    registerLsp(fakePi.pi, runtime);

    // Act
    await fakePi.runCommand("lsp", "", { hasUI: false });

    // Assert
    expect(fakePi.sentMessages[0]?.message).toMatchObject({ customType: "lsp", display: true });
    expect(JSON.stringify(fakePi.sentMessages[0]?.message)).toContain("missing LSP command");
  });

  test("clears footer status on session lifecycle events", async () => {
    // Arrange
    const fakePi = createFakePi();
    const setStatus = mock(() => undefined);
    const runtime = fakeRuntime({ adapters: [], timeoutMs: 1000 });
    registerLsp(fakePi.pi, runtime);

    // Act
    await fakePi.emit("session_start", {}, { hasUI: true, ui: { setStatus } });
    await fakePi.emit("session_shutdown", {}, { hasUI: true, ui: { setStatus } });

    // Assert
    expect(setStatus).toHaveBeenCalledTimes(2);
    expect(setStatus).toHaveBeenCalledWith("thierry-lsp", undefined);
  });
});

function fakeRuntime(loaded: LoadedLspRuntime): LspRuntime {
  return {
    load: mock(() => loaded),
    diagnostics: mock(async () => ({ content: [{ type: "text" as const, text: "diagnostics" }], details: undefined })),
    fix: mock(async () => ({ content: [{ type: "text" as const, text: "fix" }], details: undefined })),
  };
}

function fakeAdapter(name: string): LspServerAdapter {
  return {
    name,
    defaultCommand: { command: `${name}-lsp`, args: [] },
    commandEnvVar: `PI_${name.toUpperCase()}_LSP_COMMAND`,
    missingCommandHint: `Install ${name}.`,
    extensions: [".fake"],
    fileNames: [],
    skipDirectories: new Set(),
    isSupportedFile: () => false,
    languageIdFor: () => name,
  };
}
