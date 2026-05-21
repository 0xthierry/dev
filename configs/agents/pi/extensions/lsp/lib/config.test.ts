import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configToAdapter, loadConfig, normalizeConfig, parseConfigSource } from "./config";

describe("loadConfig", () => {
  const originalConfig = process.env.PI_LSP_CONFIG;

  afterEach(() => {
    if (originalConfig === undefined) delete process.env.PI_LSP_CONFIG;
    else process.env.PI_LSP_CONFIG = originalConfig;
  });

  test("uses defaults from the CR tool installer when no config is provided", async () => {
    // Arrange
    delete process.env.PI_LSP_CONFIG;
    const cwd = await mkdtemp(join(tmpdir(), "pi-lsp-config-cwd-"));
    const agentDir = await mkdtemp(join(tmpdir(), "pi-lsp-config-agent-"));

    try {
      // Act
      const config = loadConfig(cwd, agentDir);

      // Assert
      expect(config.servers.map((server) => server.name)).toEqual([
        "typescript",
        "json",
        "html",
        "css",
        "rust",
        "go",
        "pyright",
        "bash",
        "yaml",
        "taplo",
        "lua",
        "clangd",
        "tailwindcss",
        "dockerfile",
        "marksman",
      ]);
      expect(config.servers.find((server) => server.name === "pyright")?.command).toEqual([
        "pyright-langserver",
        "--stdio",
      ]);
      expect(config.servers.find((server) => server.name === "dockerfile")?.fileNames).toContain("Dockerfile");
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  test("loads inline PI_LSP_CONFIG JSON", () => {
    // Arrange
    process.env.PI_LSP_CONFIG = JSON.stringify({ fake: { command: ["fake-lsp"], extensions: ["ts"] } });

    // Act
    const config = loadConfig(process.cwd(), "/tmp/pi-lsp-missing-agent-dir");

    // Assert
    expect(config.servers).toEqual([{ name: "fake", command: ["fake-lsp"], extensions: [".ts"], fileNames: [] }]);
  });
});

describe("normalizeConfig", () => {
  test("normalizes the wrapper shape with timeout", () => {
    // Arrange
    const value = {
      timeout: 30_000,
      servers: {
        dockerfile: { command: ["docker-langserver", "--stdio"], fileNames: ["Dockerfile"] },
      },
    };

    // Act
    const config = normalizeConfig(value, "test-config");

    // Assert
    expect(config.timeout).toBe(30_000);
    expect(config.servers[0]).toEqual({
      name: "dockerfile",
      command: ["docker-langserver", "--stdio"],
      extensions: [],
      fileNames: ["Dockerfile"],
    });
  });

  test("rejects servers without extensions or file names", () => {
    // Arrange
    const value = { empty: { command: ["empty-lsp"] } };

    // Act / Assert
    expect(() => normalizeConfig(value, "test-config")).toThrow("at least one extension or fileName");
  });
});

describe("parseConfigSource", () => {
  test("parses inline JSON sources", () => {
    // Arrange
    const source = JSON.stringify({ markdown: { command: ["marksman", "server"], extensions: [".md"] } });

    // Act
    const config = parseConfigSource(source, process.cwd(), "inline");

    // Assert
    expect(config.servers[0]?.name).toBe("markdown");
  });
});

describe("configToAdapter", () => {
  test("matches configured extensions and exact file names", () => {
    // Arrange
    const adapter = configToAdapter({
      name: "dockerfile",
      command: ["docker-langserver", "--stdio"],
      extensions: [".dockerfile"],
      fileNames: ["Dockerfile"],
    });

    // Act
    const dockerfileSupported = adapter.isSupportedFile("/repo/Dockerfile");
    const extensionSupported = adapter.isSupportedFile("/repo/test.dockerfile");
    const languageId = adapter.languageIdFor("/repo/Dockerfile");

    // Assert
    expect(adapter.commandEnvVar).toBe("PI_DOCKERFILE_LSP_COMMAND");
    expect(dockerfileSupported).toBe(true);
    expect(extensionSupported).toBe(true);
    expect(languageId).toBe("dockerfile");
  });
});
