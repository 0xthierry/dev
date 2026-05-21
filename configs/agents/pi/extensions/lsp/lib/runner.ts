import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { commandFromEnv } from "./command";
import { collectSupportedFiles, resolveRoot, resolveSupportedFile } from "./files";
import { type LspSessionFactory, nodeLspSessionFactory } from "./lsp-client";
import { applyTextEdits, collectWorkspaceEdits, hasOverlappingTextEdits } from "./text-edits";
import type {
  CodeAction,
  DiagnosticEntry,
  LspServerAdapter,
  LspTextEdit,
  StatusContext,
  TextToolResult,
} from "./types";

export const DEFAULT_FILE_LIMIT = 50;

export async function runDiagnostics(
  adapter: LspServerAdapter,
  params: { root?: string; paths?: string[]; limit?: number; files?: string[] },
  timeoutMs: number,
  signal: AbortSignal | undefined,
  ctx: StatusContext,
  statusKey: string,
  sessionFactory: LspSessionFactory = nodeLspSessionFactory,
): Promise<TextToolResult> {
  const root = resolveRoot(params.root);
  const command = commandFromEnv(adapter.commandEnvVar, adapter.defaultCommand);
  const files = params.files ?? collectSupportedFiles(adapter, root, params.paths, params.limit ?? DEFAULT_FILE_LIMIT);
  if (files.length === 0) {
    return textResult(`${adapter.name} LSP found no supported files to check.`, {
      root,
      command,
      files: [],
      summary: { files: 0, diagnostics: 0 },
    });
  }

  const session = sessionFactory.create(adapter, command, root, timeoutMs);
  const abort = () => session.close();
  signal?.addEventListener("abort", abort, { once: true });
  throwIfAborted(signal, adapter);
  ctx.ui.setStatus(statusKey, `${adapter.name} diagnostics`);

  try {
    await session.start();
    await session.initialize(root);

    const entries: DiagnosticEntry[] = [];
    for (const file of files) {
      throwIfAborted(signal, adapter);
      const uri = pathToFileURL(file).href;
      const text = readFileSync(file, "utf8");
      session.didOpen(uri, text, adapter.languageIdFor(file));
      try {
        const diagnostics = await session.diagnostics(uri);
        entries.push({ path: path.relative(root, file) || file, uri, diagnostics });
      } finally {
        session.didClose(uri);
      }
    }

    return textResult(formatDiagnostics(adapter, entries), {
      root,
      command,
      files: entries,
      summary: summarize(entries),
    });
  } finally {
    ctx.ui.setStatus(statusKey, undefined);
    signal?.removeEventListener("abort", abort);
    await session.shutdown();
  }
}

export async function runFix(
  adapter: LspServerAdapter,
  params: { root?: string; path: string; kind?: string; write?: boolean },
  timeoutMs: number,
  signal: AbortSignal | undefined,
  ctx: StatusContext,
  statusKey: string,
  sessionFactory: LspSessionFactory = nodeLspSessionFactory,
): Promise<TextToolResult> {
  const root = resolveRoot(params.root);
  const file = resolveSupportedFile(adapter, root, params.path);

  if (params.write) {
    return withFileMutationQueue(file, () =>
      computeFix(adapter, root, file, params, timeoutMs, signal, ctx, statusKey, sessionFactory),
    );
  }

  return computeFix(adapter, root, file, params, timeoutMs, signal, ctx, statusKey, sessionFactory);
}

export function formatDiagnostics(adapter: LspServerAdapter, entries: DiagnosticEntry[]): string {
  const lines = entries.flatMap((entry) => {
    if (entry.diagnostics.length === 0) return [`${entry.path}: no diagnostics`];

    return entry.diagnostics.map((diagnostic) => {
      const line = diagnostic.range.start.line + 1;
      const column = diagnostic.range.start.character + 1;
      const severity = severityName(diagnostic.severity);
      const source = diagnostic.source ?? adapter.name;
      const code = diagnostic.code === undefined ? "" : ` ${diagnostic.code}`;
      return `${entry.path}:${line}:${column}: ${severity} ${source}${code}: ${diagnostic.message}`;
    });
  });

  const summary = summarize(entries);
  return [
    `${adapter.name} LSP diagnostics: ${summary.diagnostics} diagnostic(s) across ${summary.files} file(s).`,
    "",
    ...lines,
  ].join("\n");
}

export function selectCodeActions(actions: CodeAction[], requestedKind: string): CodeAction[] {
  return actions.filter((action) => action.kind === requestedKind || action.kind?.startsWith(`${requestedKind}.`));
}

export function textResult(text: string, details?: unknown): TextToolResult {
  const truncation = truncateHead(text, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  if (!truncation.truncated) {
    return { content: [{ type: "text", text }], details };
  }

  const fullOutputPath = writeFullOutput(text);
  const notice =
    `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines ` +
    `(${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). ` +
    `Full output saved to: ${fullOutputPath}]`;
  return {
    content: [{ type: "text", text: `${truncation.content}${notice}` }],
    details: addTruncationDetails(details, truncation, fullOutputPath),
  };
}

async function computeFix(
  adapter: LspServerAdapter,
  root: string,
  file: string,
  params: { kind?: string; write?: boolean },
  timeoutMs: number,
  signal: AbortSignal | undefined,
  ctx: StatusContext,
  statusKey: string,
  sessionFactory: LspSessionFactory,
): Promise<TextToolResult> {
  const actionKind = params.kind?.trim() || "source.fixAll";
  const command = commandFromEnv(adapter.commandEnvVar, adapter.defaultCommand);
  const session = sessionFactory.create(adapter, command, root, timeoutMs);
  const abort = () => session.close();
  signal?.addEventListener("abort", abort, { once: true });
  throwIfAborted(signal, adapter);
  ctx.ui.setStatus(statusKey, `${adapter.name} fix`);

  try {
    await session.start();
    await session.initialize(root);
    throwIfAborted(signal, adapter);
    const uri = pathToFileURL(file).href;
    const text = readFileSync(file, "utf8");
    session.didOpen(uri, text, adapter.languageIdFor(file));
    let resolvedActions: CodeAction[];
    let selectedActions: CodeAction[];
    let edits: LspTextEdit[];
    let newText: string;
    try {
      const diagnostics = await session.diagnostics(uri);
      const actions = await session.codeActions(uri, text, diagnostics, actionKind);
      resolvedActions = await session.resolveActions(actions);
      selectedActions = selectCodeActions(resolvedActions, actionKind);
      edits = selectedActions.flatMap((action) => collectWorkspaceEdits(action.edit, uri));
      if (hasOverlappingTextEdits(text, edits)) {
        const relativePath = path.relative(root, file) || file;
        throw new Error(
          `${adapter.name} LSP returned overlapping code-action edits for ${relativePath}; use a narrower action kind.`,
        );
      }
      newText = applyTextEdits(text, edits);
    } finally {
      session.didClose(uri);
    }
    const changed = newText !== text;

    if (params.write && changed) writeFileSync(file, newText);

    return textResult(formatEditSummary(adapter, "fix", root, file, changed, params.write, newText), {
      path: path.relative(root, file) || file,
      uri,
      changed,
      write: params.write ?? false,
      kind: actionKind,
      actions: resolvedActions.map(({ title, kind }) => ({ title, kind })),
      appliedActions: selectedActions.map(({ title, kind }) => ({ title, kind })),
      edits,
      text: params.write ? undefined : newText,
    });
  } finally {
    ctx.ui.setStatus(statusKey, undefined);
    signal?.removeEventListener("abort", abort);
    await session.shutdown();
  }
}

function formatEditSummary(
  adapter: LspServerAdapter,
  action: "fix",
  root: string,
  file: string,
  changed: boolean,
  write: boolean | undefined,
  text: string,
): string {
  const relativePath = path.relative(root, file) || file;
  const status = changed ? (write ? "updated" : "computed changes for") : "left unchanged";
  const summary = `${adapter.name} LSP ${action} ${status} ${relativePath}.`;
  if (write || !changed) return summary;
  return `${summary}\n\n${text}`;
}

function summarize(entries: DiagnosticEntry[]) {
  return {
    files: entries.length,
    diagnostics: entries.reduce((total, entry) => total + entry.diagnostics.length, 0),
  };
}

function severityName(severity: number | undefined): string {
  if (severity === 1) return "error";
  if (severity === 2) return "warning";
  if (severity === 3) return "info";
  if (severity === 4) return "hint";
  return "diagnostic";
}

function throwIfAborted(signal: AbortSignal | undefined, adapter: LspServerAdapter): void {
  if (signal?.aborted) throw new Error(`${adapter.name} LSP request aborted.`);
}

function addTruncationDetails(
  details: unknown,
  truncation: ReturnType<typeof truncateHead>,
  fullOutputPath: string,
): unknown {
  if (isRecord(details)) return { ...details, truncation, fullOutputPath };
  return { details, truncation, fullOutputPath };
}

function writeFullOutput(text: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), "pi-lsp-"));
  const filePath = path.join(directory, "output.txt");
  writeFileSync(filePath, text, "utf8");
  return filePath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
