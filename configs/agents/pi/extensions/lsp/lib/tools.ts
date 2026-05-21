import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveRoot } from "./files";
import type { LspRuntime } from "./runtime";

const ServerParameter = Type.Optional(
  Type.Union([Type.String(), Type.Array(Type.String())], {
    description:
      "Optional configured LSP server name, or names for diagnostics. Defaults to all servers matching the file extension or file name.",
  }),
);

const DiagnosticsParameters = Type.Object({
  paths: Type.Optional(
    Type.Array(Type.String(), {
      description:
        "Files or directories to check. Defaults to the workspace root and routes by configured server extensions/file names.",
    }),
  ),
  root: Type.Optional(Type.String({ description: "Workspace root for language servers. Defaults to cwd." })),
  limit: Type.Optional(Type.Number({ description: "Maximum files to open per selected server." })),
  server: ServerParameter,
});

const SingleFileParameters = {
  path: Type.String({
    description: "File to process. The server is selected from configured file extensions/file names.",
  }),
  root: Type.Optional(Type.String({ description: "Workspace root for language servers. Defaults to cwd." })),
  write: Type.Optional(Type.Boolean({ description: "Write changed text back to the file. Defaults to false." })),
  server: Type.Optional(
    Type.String({
      description: "Optional configured LSP server name. Defaults to extension/file-name inference.",
    }),
  ),
};

type DiagnosticsInput = {
  paths?: string[];
  root?: string;
  limit?: number;
  server?: string | string[];
};

type FixInput = {
  path: string;
  root?: string;
  kind?: string;
  write?: boolean;
  server?: string;
};

export function registerLspTools(pi: ExtensionAPI, runtime: LspRuntime, statusKey: string): void {
  pi.registerTool({
    name: "lsp_diagnostics",
    label: "LSP: Diagnostics",
    description:
      "Run diagnostics using configured LSP server routes. Output is truncated to 50KB or 2000 lines when needed.",
    promptSnippet: "Get diagnostics from configured LSP servers selected by file extension or file name",
    promptGuidelines: [
      "Use lsp_diagnostics when files need diagnostics from a configured LSP server.",
      "Use the server parameter only when the user asks for a specific configured LSP server or multiple servers match the same file.",
      "If a configured server command is missing, report the configuration error and suggest installing the command or setting its PI_<SERVER>_LSP_COMMAND environment variable.",
    ],
    parameters: DiagnosticsParameters,
    async execute(_toolCallId, params: DiagnosticsInput, signal, _onUpdate, ctx: ExtensionContext) {
      const root = resolveRequestedRoot(ctx.cwd, params.root);
      const loaded = runtime.load(root);
      return runtime.diagnostics(loaded, { ...params, root }, signal, ctx, statusKey);
    },
  });

  pi.registerTool({
    name: "lsp_fix",
    label: "LSP: Fix",
    description:
      "Apply source fixes or import organization using configured LSP server routes. Preview output is truncated to 50KB or 2000 lines when needed.",
    promptSnippet: "Apply configured LSP source fixes to a file",
    promptGuidelines: [
      "Use lsp_fix for files handled by a configured LSP code-action server.",
      "Use kind when the server needs a specific source action kind such as source.organizeImports.",
      "Call lsp_fix with write=false first when the user asks to preview LSP edits before changing files.",
    ],
    parameters: Type.Object({
      ...SingleFileParameters,
      kind: Type.Optional(Type.String({ description: "Source action kind. Defaults to source.fixAll." })),
    }),
    async execute(_toolCallId, params: FixInput, signal, _onUpdate, ctx: ExtensionContext) {
      const root = resolveRequestedRoot(ctx.cwd, params.root);
      const loaded = runtime.load(root);
      return runtime.fix(loaded, { ...params, root }, signal, ctx, statusKey);
    },
  });
}

function resolveRequestedRoot(cwd: string, requestedRoot: string | undefined): string {
  return resolveRoot(requestedRoot ? path.resolve(cwd, requestedRoot) : cwd);
}
