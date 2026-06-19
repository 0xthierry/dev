import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createFffAutocompleteProviderFactory } from "./autocomplete";
import { registerFffCommands, sendNotice } from "./commands";
import { createFffDbPathResolver } from "./db-paths";
import { createCursorStore } from "./pagination";
import { createFffRuntime, type FffRuntimeOptions } from "./runtime";
import { registerFffTools } from "./tools";
import type { FffRuntime, MixedItem } from "./types";

const FFF_FRECENCY_DB_FLAG = "fff-frecency-db";
const FFF_HISTORY_DB_FLAG = "fff-history-db";
const FFF_ENABLE_ROOT_SCAN_FLAG = "fff-enable-root-scan";
const MENTION_PAGE_SIZE = 20;

export function registerFffExtension(pi: ExtensionAPI): void {
  registerFffFlags(pi);
  registerFff(pi, createFffRuntime(readRuntimeOptions(pi)));
}

export function registerFff(pi: ExtensionAPI, runtime: FffRuntime): void {
  const cursorStore = createCursorStore();
  let activeCwd = process.cwd();
  const getActiveCwd = () => activeCwd;

  registerFffTools(pi, runtime, cursorStore, getActiveCwd);
  registerFffCommands(pi, runtime, getActiveCwd);

  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    activeCwd = ctx.cwd;

    if (ctx.hasUI) {
      ctx.ui.addAutocompleteProvider(
        createFffAutocompleteProviderFactory(async (query, signal) => mentionItems(runtime, activeCwd, query, signal)),
      );
    }

    try {
      await runtime.ensureFinder(activeCwd);
    } catch (error) {
      sendNotice(pi, ctx, `FFF init failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  });

  pi.on("session_shutdown", () => {
    runtime.destroy();
  });
}

export function readRuntimeOptions(pi: ExtensionAPI): FffRuntimeOptions {
  return {
    resolveDbPaths: createFffDbPathResolver({
      frecencyDbPathOverride: flagString(pi, FFF_FRECENCY_DB_FLAG) ?? process.env.FFF_FRECENCY_DB,
      historyDbPathOverride: flagString(pi, FFF_HISTORY_DB_FLAG) ?? process.env.FFF_HISTORY_DB,
    }),
    enableFsRootScanning: flagBool(pi, FFF_ENABLE_ROOT_SCAN_FLAG) ?? envBool("FFF_ENABLE_ROOT_SCAN"),
  };
}

function registerFffFlags(pi: ExtensionAPI): void {
  pi.registerFlag(FFF_FRECENCY_DB_FLAG, {
    description: "Path to the FFF frecency database (overrides the project-scoped default and FFF_FRECENCY_DB).",
    type: "string",
  });

  pi.registerFlag(FFF_HISTORY_DB_FLAG, {
    description: "Path to the FFF query-history database (overrides the project-scoped default and FFF_HISTORY_DB).",
    type: "string",
  });

  pi.registerFlag(FFF_ENABLE_ROOT_SCAN_FLAG, {
    description: "Allow FFF indexing when launched from the filesystem root (also FFF_ENABLE_ROOT_SCAN=1).",
    type: "boolean",
  });
}

async function mentionItems(
  runtime: FffRuntime,
  cwd: string,
  query: string,
  signal: AbortSignal,
): Promise<MixedItem[]> {
  if (signal.aborted) return [];
  const finder = await runtime.ensureFinder(cwd);
  if (signal.aborted) return [];

  const result = finder.mixedSearch(query, { pageSize: MENTION_PAGE_SIZE });
  if (!result.ok) return [];
  return result.value.items.slice(0, MENTION_PAGE_SIZE);
}

function flagString(pi: ExtensionAPI, name: string): string | undefined {
  const value = pi.getFlag(name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function flagBool(pi: ExtensionAPI, name: string): boolean | undefined {
  const value = pi.getFlag(name);
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "1" || value === "true";
  return undefined;
}

function envBool(name: string): boolean {
  const value = process.env[name];
  return value === "1" || value === "true";
}
