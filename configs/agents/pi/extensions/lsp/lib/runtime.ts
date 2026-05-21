import { loadRuntime as loadConfiguredRuntime } from "./config";
import { selectDiagnosticRoutes, selectFixRoute } from "./routes";
import { DEFAULT_FILE_LIMIT, runDiagnostics, runFix, textResult } from "./runner";
import type { LspServerAdapter, StatusContext, TextToolResult } from "./types";

export interface LoadedLspRuntime {
  adapters: LspServerAdapter[];
  timeoutMs: number;
}

export interface LspRuntime {
  load(cwd: string): LoadedLspRuntime;
  diagnostics(
    loaded: LoadedLspRuntime,
    params: { root: string; paths?: string[]; limit?: number; server?: string | string[] },
    signal: AbortSignal | undefined,
    ctx: StatusContext,
    statusKey: string,
  ): Promise<TextToolResult>;
  fix(
    loaded: LoadedLspRuntime,
    params: { root: string; path: string; kind?: string; write?: boolean; server?: string },
    signal: AbortSignal | undefined,
    ctx: StatusContext,
    statusKey: string,
  ): Promise<TextToolResult>;
}

export function createLspRuntime(): LspRuntime {
  return {
    load: loadConfiguredRuntime,
    async diagnostics(loaded, params, signal, ctx, statusKey) {
      const { root, routes } = selectDiagnosticRoutes(loaded.adapters, params, DEFAULT_FILE_LIMIT);
      const results = [];
      for (const route of routes) {
        const result = await runDiagnostics(
          route.adapter,
          { root, paths: params.paths, limit: params.limit, files: route.files },
          loaded.timeoutMs,
          signal,
          ctx,
          statusKey,
        );
        results.push({ route, result });
      }

      const text = results
        .map(({ route, result }) => `${route.reason}\n\n${textFromResult(result)}`)
        .join("\n\n---\n\n");
      return textResult(text, {
        root,
        routes: results.map(({ route, result }) => ({
          server: route.adapter.name,
          reason: route.reason,
          files: route.files,
          details: result.details,
        })),
      });
    },
    async fix(loaded, params, signal, ctx, statusKey) {
      const { root, route } = selectFixRoute(loaded.adapters, params);
      return runFix(
        route.adapter,
        { root, path: params.path, kind: params.kind, write: params.write },
        loaded.timeoutMs,
        signal,
        ctx,
        statusKey,
      );
    },
  };
}

function textFromResult(result: { content?: Array<{ type?: string; text?: string }> }): string {
  return result.content?.find((item) => item.type === "text")?.text ?? "";
}
