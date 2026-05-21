import { afterEach, describe, expect, test } from "bun:test";
import { createLspRuntime } from "./runtime";

describe("createLspRuntime", () => {
  const originalConfig = process.env.PI_LSP_CONFIG;

  afterEach(() => {
    if (originalConfig === undefined) delete process.env.PI_LSP_CONFIG;
    else process.env.PI_LSP_CONFIG = originalConfig;
  });

  test("loads configured adapters and timeout", () => {
    // Arrange
    process.env.PI_LSP_CONFIG = JSON.stringify({
      timeout: 1234,
      servers: { fake: { command: ["fake-lsp"], extensions: [".fake"] } },
    });
    const runtime = createLspRuntime();

    // Act
    const loaded = runtime.load(process.cwd());

    // Assert
    expect(loaded.timeoutMs).toBe(1234);
    expect(loaded.adapters.map((adapter) => adapter.name)).toEqual(["fake"]);
  });
});
