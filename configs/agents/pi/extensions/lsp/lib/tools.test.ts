import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePi } from "../../_shared/testing/fake-pi";
import type { LoadedLspRuntime, LspRuntime } from "./runtime";
import { registerLspTools } from "./tools";

describe("registerLspTools", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
    mock.clearAllMocks();
  });

  test("registers diagnostics and fix tools", () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = fakeRuntime(fakeLoadedRuntime());

    // Act
    registerLspTools(fakePi.pi, runtime, "test-lsp");

    // Assert
    expect(fakePi.tools.has("lsp_diagnostics")).toBe(true);
    expect(fakePi.tools.has("lsp_fix")).toBe(true);
  });

  test("runs diagnostics through the provided runtime", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-lsp-tools-"));
    const fakePi = createFakePi({ cwd: tempDir });
    const loaded = fakeLoadedRuntime();
    const runtime = fakeRuntime(loaded);
    registerLspTools(fakePi.pi, runtime, "test-lsp");

    // Act
    const result = await fakePi.runTool("lsp_diagnostics", { paths: ["src"], server: "typescript" });

    // Assert
    expect(runtime.load).toHaveBeenCalledWith(tempDir);
    expect(runtime.diagnostics).toHaveBeenCalledWith(
      loaded,
      { paths: ["src"], server: "typescript", root: tempDir },
      undefined,
      expect.any(Object),
      "test-lsp",
    );
    expect(result).toEqual({ content: [{ type: "text", text: "diagnostics ok" }], details: { ok: true } });
  });

  test("runs fixes through the provided runtime", async () => {
    // Arrange
    tempDir = await mkdtemp(join(tmpdir(), "pi-lsp-tools-"));
    const fakePi = createFakePi({ cwd: tempDir });
    const loaded = fakeLoadedRuntime();
    const runtime = fakeRuntime(loaded);
    registerLspTools(fakePi.pi, runtime, "test-lsp");

    // Act
    const result = await fakePi.runTool("lsp_fix", { path: "main.ts", kind: "source.organizeImports", write: false });

    // Assert
    expect(runtime.fix).toHaveBeenCalledWith(
      loaded,
      { path: "main.ts", kind: "source.organizeImports", write: false, root: tempDir },
      undefined,
      expect.any(Object),
      "test-lsp",
    );
    expect(result).toEqual({ content: [{ type: "text", text: "fix ok" }], details: { ok: true } });
  });
});

function fakeLoadedRuntime(): LoadedLspRuntime {
  return { adapters: [], timeoutMs: 1000 };
}

function fakeRuntime(loaded: LoadedLspRuntime): LspRuntime {
  return {
    load: mock(() => loaded),
    diagnostics: mock(async () => ({
      content: [{ type: "text" as const, text: "diagnostics ok" }],
      details: { ok: true },
    })),
    fix: mock(async () => ({ content: [{ type: "text" as const, text: "fix ok" }], details: { ok: true } })),
  };
}
