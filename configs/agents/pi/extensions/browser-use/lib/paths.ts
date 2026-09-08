import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type BrowserUsePaths = {
  available: true;
  nodeRepl: string;
  node: string;
  nodeModules: string;
  browserClient: string;
  browserService: string;
  codexHome: string;
  codexCli: string;
};

export type BrowserUsePathsResult =
  | BrowserUsePaths
  | {
      available: false;
      reason: string;
    };

export type BrowserUsePathOptions = {
  home?: string;
  resourcesRoot?: string;
  platform?: NodeJS.Platform;
};

export function browserUseResourceRoots(platform: NodeJS.Platform, home: string): string[] {
  if (platform === "darwin") {
    return ["/Applications", join(home, "Applications")].flatMap((directory) =>
      ["ChatGPT.app", "Codex.app"].map((app) => join(directory, app, "Contents/Resources")),
    );
  }
  return platform === "linux" ? ["/usr/lib/chatgpt/resources"] : [];
}

export function resolveBrowserUsePaths(options: BrowserUsePathOptions = {}): BrowserUsePathsResult {
  const home = options.home ?? homedir();
  const override = options.resourcesRoot ?? process.env.PI_BROWSER_USE_RESOURCES_ROOT;
  const roots = override ? [override] : browserUseResourceRoots(options.platform ?? process.platform, home);
  const kernelRoots = roots.filter((root) =>
    ["node_repl", "node"].every((binary) => existsSync(join(root, "cua_node/bin", binary))),
  );
  // Prefer a complete bundle when both desktop apps are installed on macOS.
  const resourcesRoot = kernelRoots.find((root) => existsSync(join(root, "codex"))) ?? kernelRoots[0];
  if (!resourcesRoot) {
    return {
      available: false,
      reason: `Trusted browser kernel is missing. Install ChatGPT/Codex desktop with cua_node or set PI_BROWSER_USE_RESOURCES_ROOT. Searched: ${roots.join(", ") || "no supported default locations"}.`,
    };
  }
  const codexHome = join(home, ".codex");
  const nodeRepl = join(resourcesRoot, "cua_node/bin/node_repl");
  const node = join(resourcesRoot, "cua_node/bin/node");
  const nodeModules = join(resourcesRoot, "cua_node/lib/node_modules");
  const codexCli = join(resourcesRoot, "codex");

  if (!existsSync(codexCli)) {
    return {
      available: false,
      reason: `Bundled Codex CLI is missing at ${codexCli}; browser authentication requires it.`,
    };
  }

  const browserClient = firstExisting([
    join(codexHome, "plugins/cache/openai-bundled/chrome/latest/scripts/browser-client.mjs"),
    join(resourcesRoot, "plugins/openai-bundled/plugins/chrome/scripts/browser-client.mjs"),
  ]);
  if (!browserClient) {
    return {
      available: false,
      reason: "browser-client.mjs is missing from the Chrome plugin cache and desktop bundle.",
    };
  }

  const browserService = firstExisting([
    join(codexHome, "plugins/cache/openai-bundled/browser/latest/scripts/browser-service.mjs"),
    join(resourcesRoot, "plugins/openai-bundled/plugins/browser/scripts/browser-service.mjs"),
    join(codexHome, "plugins/cache/openai-bundled/chrome/latest/scripts/browser-service.mjs"),
    join(resourcesRoot, "plugins/openai-bundled/plugins/chrome/scripts/browser-service.mjs"),
  ]);
  if (!browserService) {
    return { available: false, reason: "browser-service.mjs is missing from the plugin cache and desktop bundle." };
  }

  return {
    available: true,
    nodeRepl,
    node,
    nodeModules,
    browserClient,
    browserService,
    codexHome,
    codexCli,
  };
}

export function buildBrowserUseEnvironment(
  paths: BrowserUsePaths,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  // Trust the selected scripts, including their canonical locations behind cache symlinks.
  // Do not trust the entire desktop resources tree or an arbitrary filesystem root.
  const scriptRoots = [paths.browserClient, paths.browserService].flatMap((path) => [
    dirname(path),
    dirname(realpathSync(path)),
  ]);
  return {
    ...inherited,
    CODEX_HOME: paths.codexHome,
    NODE_REPL_NODE_PATH: paths.node,
    NODE_REPL_NODE_MODULE_DIRS: paths.nodeModules,
    NODE_REPL_TRUSTED_CODE_PATHS: [...new Set([paths.codexHome, paths.nodeModules, ...scriptRoots])].join(delimiter),
    NODE_REPL_TRUSTED_SERVICES: JSON.stringify({ browser: paths.browserService }),
    BROWSER_USE_AVAILABLE_BACKENDS: "chrome",
    BROWSER_USE_TINYSKY_ENABLED: "1",
    BROWSER_USE_CODEX_CLI: paths.codexCli,
    CODEX_CLI_PATH: fileURLToPath(new URL("./codex-browser-cli.sh", import.meta.url)),
  };
}

function firstExisting(paths: string[]): string | undefined {
  return paths.find((path) => existsSync(path));
}
