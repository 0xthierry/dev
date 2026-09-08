import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { browserUseResourceRoots, buildBrowserUseEnvironment, resolveBrowserUsePaths } from "./paths";

test("discovers Linux and macOS desktop resource layouts", () => {
  // Arrange
  const home = "/Users/test";

  // Act
  const linux = browserUseResourceRoots("linux", home);
  const mac = browserUseResourceRoots("darwin", home);

  // Assert
  expect(linux).toEqual(["/usr/lib/chatgpt/resources"]);
  expect(mac).toEqual([
    "/Applications/ChatGPT.app/Contents/Resources",
    "/Applications/Codex.app/Contents/Resources",
    "/Users/test/Applications/ChatGPT.app/Contents/Resources",
    "/Users/test/Applications/Codex.app/Contents/Resources",
  ]);
  expect(browserUseResourceRoots("win32", home)).toEqual([]);
});

describe("resolveBrowserUsePaths", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  test("reports missing kernel binaries", async () => {
    // Arrange
    root = await mkdtemp(join(tmpdir(), "browser-use-paths-"));

    // Act
    const result = resolveBrowserUsePaths({ home: root, resourcesRoot: join(root, "missing") });

    // Assert
    expect(result.available).toBe(false);
    if (result.available) throw new Error("expected unavailable");
    expect(result.reason).toContain("Trusted browser kernel is missing");
  });

  test("trusts bundled services and canonical cache script locations without trusting all resources", async () => {
    // Arrange
    root = await mkdtemp(join(tmpdir(), "browser-use-trust-"));
    const resourcesRoot = join(root, "resources");
    const cacheScripts = join(root, "home/.codex/plugins/cache/openai-bundled/chrome/latest/scripts");
    const actualScripts = join(root, "plugin/scripts");
    const serviceScripts = join(resourcesRoot, "plugins/openai-bundled/plugins/browser/scripts");
    await mkdir(join(resourcesRoot, "cua_node/bin"), { recursive: true });
    await writeFile(join(resourcesRoot, "cua_node/bin/node_repl"), "");
    await writeFile(join(resourcesRoot, "cua_node/bin/node"), "");
    await writeFile(join(resourcesRoot, "codex"), "");
    await mkdir(actualScripts, { recursive: true });
    await mkdir(dirname(cacheScripts), { recursive: true });
    await symlink(actualScripts, cacheScripts);
    await writeFile(join(actualScripts, "browser-client.mjs"), "");
    await mkdir(serviceScripts, { recursive: true });
    await writeFile(join(serviceScripts, "browser-service.mjs"), "");
    const paths = resolveBrowserUsePaths({ home: join(root, "home"), resourcesRoot });
    if (!paths.available) throw new Error(paths.reason);

    // Act
    const environment = buildBrowserUseEnvironment(paths, { TEST_SENTINEL: "preserved" });

    // Assert
    const trusted = environment.NODE_REPL_TRUSTED_CODE_PATHS?.split(delimiter);
    expect(trusted).toContain(cacheScripts);
    expect(trusted).toContain(actualScripts);
    expect(trusted).toContain(serviceScripts);
    expect(trusted).not.toContain(resourcesRoot);
    expect(environment.BROWSER_USE_AVAILABLE_BACKENDS).toBe("chrome");
    expect(environment.TEST_SENTINEL).toBe("preserved");
    expect(environment.BROWSER_USE_CODEX_CLI).toBe(paths.codexCli);
    expect(environment.CODEX_CLI_PATH).toEndWith("/codex-browser-cli.sh");
    expect(JSON.parse(environment.NODE_REPL_TRUSTED_SERVICES ?? "{}")).toEqual({ browser: paths.browserService });
  });

  test("resolves cache plugin scripts when present", async () => {
    // Arrange
    root = await mkdtemp(join(tmpdir(), "browser-use-paths-"));
    const resourcesRoot = join(root, "resources");
    const home = join(root, "home");
    await mkdir(join(resourcesRoot, "cua_node/bin"), { recursive: true });
    await writeFile(join(resourcesRoot, "cua_node/bin/node_repl"), "");
    await writeFile(join(resourcesRoot, "cua_node/bin/node"), "");
    await writeFile(join(resourcesRoot, "codex"), "");
    await mkdir(join(home, ".codex/plugins/cache/openai-bundled/chrome/latest/scripts"), { recursive: true });
    await writeFile(join(home, ".codex/plugins/cache/openai-bundled/chrome/latest/scripts/browser-client.mjs"), "");
    await writeFile(join(home, ".codex/plugins/cache/openai-bundled/chrome/latest/scripts/browser-service.mjs"), "");

    // Act
    const result = resolveBrowserUsePaths({ home, resourcesRoot });

    // Assert
    expect(result).toMatchObject({
      available: true,
      nodeRepl: join(resourcesRoot, "cua_node/bin/node_repl"),
      browserClient: join(home, ".codex/plugins/cache/openai-bundled/chrome/latest/scripts/browser-client.mjs"),
      browserService: join(home, ".codex/plugins/cache/openai-bundled/chrome/latest/scripts/browser-service.mjs"),
    });
  });
});
