import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { clearCloneCache } from "./providers/github/clone";
import { clearResults } from "./storage/result-store";
import { restoreFromEntries } from "./storage/session-entries";
import { registerFetchContentTool } from "./tools/fetch-content-tool";
import { registerGetSearchContentTool } from "./tools/get-search-content-tool";
import { createWebAccessRuntime, type WebAccessRuntime } from "./tools/runtime";
import { registerWebSearchTool } from "./tools/web-search-tool";

export function registerWebAccessExtension(pi: ExtensionAPI): void {
  registerWebAccessTools(pi, createWebAccessRuntime());
}

export function registerWebAccessTools(pi: ExtensionAPI, runtime: WebAccessRuntime): void {
  pi.on("session_start", (_event, ctx) => restoreFromEntries(ctx.sessionManager.getBranch()));
  pi.on("session_tree", (_event, ctx) => restoreFromEntries(ctx.sessionManager.getBranch()));
  pi.on("session_shutdown", () => {
    clearResults();
    clearCloneCache();
  });

  registerWebSearchTool(pi, runtime);
  registerFetchContentTool(pi, runtime);
  registerGetSearchContentTool(pi);
}
