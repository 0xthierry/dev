import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";
import { formatFindOutput, formatGrepOutput, renderTextResult } from "./output";
import type { CursorStore } from "./pagination";
import { buildQuery } from "./query";
import type { FffRuntime, GrepMode } from "./types";

const DEFAULT_GREP_LIMIT = 20;
const DEFAULT_FIND_LIMIT = 30;
const MAX_MATCHES_PER_FILE = 50;

const PathDescription =
  "Repo-relative path constraint. Directory prefix (src/ or src/foo/), bare filename with extension (main.rs), or glob (*.ts, src/**/*.cc, {src,lib}/**). Applied to the full repo-relative path.";

const ExcludeDescription =
  "Exclude paths (comma/space-separated or array). Same syntax as path: directory prefix ('test/'), filename with extension ('config.json'), or glob ('*.min.js', '**/*.{rs,go}'). A leading '!' is optional and ignored — both 'test/' and '!test/' work. Example: 'test/,*.min.js,!vendor/'.";

export const GrepParameters = Type.Object({
  pattern: Type.String({ description: "Search pattern (literal text or regex)" }),
  path: Type.Optional(Type.String({ description: PathDescription })),
  exclude: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())], { description: ExcludeDescription })),
  caseSensitive: Type.Optional(
    Type.Boolean({
      description:
        "Force case-sensitive matching. Default uses smart-case (case-insensitive when pattern is all lowercase).",
    }),
  ),
  context: Type.Optional(Type.Number({ description: "Context lines before+after each match" })),
  limit: Type.Optional(Type.Number({ description: `Max matches (default ${DEFAULT_GREP_LIMIT})` })),
  cursor: Type.Optional(Type.String({ description: "Pagination cursor from previous result" })),
});

export const FindParameters = Type.Object({
  pattern: Type.String({
    description:
      "Fuzzy filename search and glob search. Frecency-ranked, git-aware. Multi-word = narrower (AND) not bound to order, use for multi word related concept search. Prefer this over ls/find/bash as the first exploration step whenever the user names a concept, feature, or symbol — it surfaces the relevant files in one call. Only use ls/read on a directory when you specifically need the alphabetical layout of an unknown repo, or when a concept search returned nothing.",
  }),
  path: Type.Optional(Type.String({ description: PathDescription })),
  exclude: Type.Optional(Type.Union([Type.String(), Type.Array(Type.String())], { description: ExcludeDescription })),
  limit: Type.Optional(Type.Number({ description: `Max results per page (default ${DEFAULT_FIND_LIMIT})` })),
  cursor: Type.Optional(Type.String({ description: "Pagination cursor from previous result" })),
});

export const MultiGrepParameters = Type.Object({
  patterns: Type.Array(Type.String(), {
    description: "Literal patterns (OR). Include snake_case/camelCase/PascalCase variants.",
  }),
  constraints: Type.Optional(Type.String({ description: "File filter, e.g. '*.{ts,tsx} !test/'" })),
  context: Type.Optional(Type.Number({ description: "Context lines before+after" })),
  limit: Type.Optional(Type.Number({ description: `Max matches (default ${DEFAULT_GREP_LIMIT})` })),
  cursor: Type.Optional(Type.String({ description: "Pagination cursor" })),
});

type GrepParams = Static<typeof GrepParameters>;
type FindParams = Static<typeof FindParameters>;
type MultiGrepParams = Static<typeof MultiGrepParameters>;

type CwdProvider = () => string;

export function registerFffTools(
  pi: ExtensionAPI,
  runtime: FffRuntime,
  cursorStore: CursorStore,
  getActiveCwd: CwdProvider,
): void {
  registerGrepTool(pi, runtime, cursorStore, getActiveCwd);
  registerFindTool(pi, runtime, cursorStore, getActiveCwd);
  registerMultiGrepTool(pi, runtime, cursorStore, getActiveCwd);
}

export function detectGrepMode(pattern: string): GrepMode {
  if (!hasRegexSyntax(pattern)) return "plain";
  try {
    new RegExp(pattern);
    return "regex";
  } catch {
    return "plain";
  }
}

export function isWildcardOnlyPattern(pattern: string): boolean {
  const trimmed = pattern.trim();
  return (
    hasRegexSyntax(trimmed) &&
    /^(?:[.^$]*(?:[.][*+?]|\*|\+)[.^$]*|[.^$\s]*|\.\*\??|\.\*[+?]?|\.\+\??|\.|\*|\?)$/.test(trimmed)
  );
}

function registerGrepTool(
  pi: ExtensionAPI,
  runtime: FffRuntime,
  cursorStore: CursorStore,
  getActiveCwd: CwdProvider,
): void {
  pi.registerTool({
    name: "grep",
    label: "grep",
    description: `Grep file contents. Smart-case, auto-detects regex vs literal, git-aware. Results are ranked by frecency (most-accessed files first); matches within a file stay in source order. Default limit ${DEFAULT_GREP_LIMIT}.`,
    promptSnippet: "Grep contents",
    promptGuidelines: [
      "Prefer bare identifiers as patterns. Literal queries are most efficient.",
      "Use path for include ('src/', '*.ts') and exclude for noise ('test/,*.min.js').",
      "caseSensitive: true when you need exact case (smart-case otherwise).",
      "After 1-2 greps, read the top match instead of more greps.",
    ],
    parameters: GrepParameters,

    async execute(_toolCallId, params: GrepParams, signal, _onUpdate, ctx) {
      if (signal?.aborted) throw new Error("Operation aborted");
      if (isWildcardOnlyPattern(params.pattern)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Pattern '${params.pattern}' matches everything. Grep needs a concrete substring or identifier, for example pattern: 'MyClass' or pattern: 'export function'.`,
            },
          ],
          details: { totalMatched: 0, totalFiles: 0 },
        };
      }

      const cwd = cwdForTool(ctx, getActiveCwd);
      const finder = await runtime.ensureFinder(cwd);
      const effectiveLimit = positiveLimit(params.limit, DEFAULT_GREP_LIMIT);
      const query = buildQuery(params.path, params.pattern, params.exclude, cwd);
      const mode = detectGrepMode(params.pattern);
      const smartCase = params.caseSensitive !== true;

      const search = finder.grep(query, {
        mode,
        smartCase,
        maxMatchesPerFile: Math.min(effectiveLimit, MAX_MATCHES_PER_FILE),
        pageSize: effectiveLimit,
        cursor: params.cursor ? (cursorStore.getGrep(params.cursor) ?? null) : null,
        beforeContext: params.context ?? 0,
        afterContext: params.context ?? 0,
        classifyDefinitions: true,
      });
      if (!search.ok) throw new Error(search.error);

      let result = search.value;
      let fuzzyNotice: string | null = null;

      if (result.items.length === 0 && !params.cursor && mode !== "regex") {
        const fuzzy = finder.grep(query, {
          mode: "fuzzy",
          smartCase,
          maxMatchesPerFile: Math.min(effectiveLimit, MAX_MATCHES_PER_FILE),
          pageSize: effectiveLimit,
          cursor: null,
          beforeContext: params.context ?? 0,
          afterContext: params.context ?? 0,
          classifyDefinitions: true,
        });
        if (fuzzy.ok && fuzzy.value.items.length > 0) {
          fuzzyNotice = "0 exact matches. Maybe you meant this?";
          result = fuzzy.value;
        }
      }

      let output = formatGrepOutput(result);
      const notices: string[] = [];
      if (result.regexFallbackError) notices.push(`Invalid regex: ${result.regexFallbackError}; used literal match`);
      if (result.nextCursor) notices.push(`Continue with cursor="${cursorStore.storeGrep(result.nextCursor)}"`);
      if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;
      if (fuzzyNotice) output = `[${fuzzyNotice}]\n${output}`;

      return {
        content: [{ type: "text" as const, text: output }],
        details: { totalMatched: result.totalMatched, totalFiles: result.totalFiles },
      };
    },

    renderCall(args: Partial<GrepParams> | undefined, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const pattern = args?.pattern ?? "";
      const path = args?.path ?? ".";
      let content = `${theme.fg("toolTitle", theme.bold("grep"))} ${theme.fg("accent", `/${pattern}/`)}${theme.fg("toolOutput", ` in ${path}`)}`;
      if (args?.limit !== undefined) content += theme.fg("toolOutput", ` limit ${args.limit}`);
      if (args?.cursor) content += theme.fg("muted", " (page)");
      text.setText(content);
      return text;
    },

    renderResult(result, options, theme, context) {
      return renderTextResult(result, options, theme, context, 15);
    },
  });
}

function registerFindTool(
  pi: ExtensionAPI,
  runtime: FffRuntime,
  cursorStore: CursorStore,
  getActiveCwd: CwdProvider,
): void {
  pi.registerTool({
    name: "find",
    label: "find",
    description: `Fuzzy path search and glob search. Matches against the whole repo-relative path, not just the filename. Frecency-ranked, git-aware. Multi-word = narrower (AND). Default limit ${DEFAULT_FIND_LIMIT}.`,
    promptSnippet: "Find files by path or glob",
    promptGuidelines: [
      "Matches the WHOLE path, not just the filename — `profile` hits `chrome/browser/profiles/x.cc` too.",
      "Keep queries to 1-2 terms; extra words narrow.",
      "Use for paths, not content. Use grep for content.",
      "For exact path matches use a glob in `path` — e.g. path: '**/profile.h' for exact filename, or path: 'src/**/profile.h' scoped to a subtree. Bare patterns are fuzzy.",
      "To list everything inside a directory, pass path: 'dir/**' with an empty or wildcard pattern instead of using pattern alone.",
      "Use exclude: 'test/,*.min.js' to cut noise in large repos.",
    ],
    parameters: FindParameters,

    async execute(_toolCallId, params: FindParams, signal, _onUpdate, ctx) {
      if (signal?.aborted) throw new Error("Operation aborted");

      const cwd = cwdForTool(ctx, getActiveCwd);
      const finder = await runtime.ensureFinder(cwd);
      const resumed = params.cursor ? cursorStore.getFind(params.cursor) : undefined;
      const effectiveLimit = resumed ? resumed.pageSize : positiveLimit(params.limit, DEFAULT_FIND_LIMIT);
      const query = resumed ? resumed.query : buildQuery(params.path, params.pattern, params.exclude, cwd);
      const pattern = resumed ? resumed.pattern : params.pattern;
      const pageIndex = resumed?.nextPageIndex ?? 0;

      const search = finder.fileSearch(query, { pageIndex, pageSize: effectiveLimit });
      if (!search.ok) throw new Error(search.error);

      const result = search.value;
      const formatted = formatFindOutput(result, effectiveLimit, pattern);
      let output = formatted.output;
      const shownSoFar = pageIndex * effectiveLimit + result.items.length;
      const hasMore = result.items.length >= effectiveLimit && result.totalMatched > shownSoFar;
      const notices: string[] = [];

      if (formatted.weak && formatted.shownCount > 0) {
        notices.push(
          `Query "${pattern}" produced weak scattered fuzzy matches. Output capped at ${formatted.shownCount}/${result.totalMatched}.`,
        );
      }

      if (!formatted.weak && hasMore) {
        const remaining = result.totalMatched - shownSoFar;
        const cursor = cursorStore.storeFind({
          query,
          pattern,
          pageSize: effectiveLimit,
          nextPageIndex: pageIndex + 1,
        });
        notices.push(`${remaining} more match${remaining === 1 ? "" : "es"} available. cursor="${cursor}" to continue`);
      }

      if (notices.length > 0) output += `\n\n[${notices.join(". ")}]`;

      return {
        content: [{ type: "text" as const, text: output }],
        details: { totalMatched: result.totalMatched, totalFiles: result.totalFiles, pageIndex, hasMore },
      };
    },

    renderCall(args: Partial<FindParams> | undefined, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const pattern = args?.pattern ?? "";
      const path = args?.path ?? ".";
      let content = `${theme.fg("toolTitle", theme.bold("find"))} ${theme.fg("accent", pattern)}${theme.fg("toolOutput", ` in ${path}`)}`;
      if (args?.limit !== undefined) content += theme.fg("toolOutput", ` limit ${args.limit}`);
      if (args?.cursor) content += theme.fg("muted", " (page)");
      text.setText(content);
      return text;
    },

    renderResult(result, options, theme, context) {
      return renderTextResult(result, options, theme, context, 20);
    },
  });
}

function registerMultiGrepTool(
  pi: ExtensionAPI,
  runtime: FffRuntime,
  cursorStore: CursorStore,
  getActiveCwd: CwdProvider,
): void {
  pi.registerTool({
    name: "multi_grep",
    label: "multi_grep",
    description:
      "Search file contents for ANY of multiple literal patterns (OR, SIMD Aho-Corasick). Faster than regex alternation.",
    promptSnippet: "Multi-pattern OR content search",
    promptGuidelines: [
      "Use when searching for several identifiers at once.",
      "Include all naming-convention variants (snake/camel/Pascal).",
      "Patterns are literal. Use constraints for file filters.",
    ],
    parameters: MultiGrepParameters,

    async execute(_toolCallId, params: MultiGrepParams, signal, _onUpdate, ctx) {
      if (signal?.aborted) throw new Error("Operation aborted");
      if (params.patterns.length === 0) throw new Error("patterns array must have at least one pattern");

      const cwd = cwdForTool(ctx, getActiveCwd);
      const finder = await runtime.ensureFinder(cwd);
      const effectiveLimit = positiveLimit(params.limit, DEFAULT_GREP_LIMIT);
      const search = finder.multiGrep({
        patterns: params.patterns,
        constraints: params.constraints,
        maxMatchesPerFile: Math.min(effectiveLimit, MAX_MATCHES_PER_FILE),
        pageSize: effectiveLimit,
        smartCase: true,
        cursor: params.cursor ? (cursorStore.getGrep(params.cursor) ?? null) : null,
        beforeContext: params.context ?? 0,
        afterContext: params.context ?? 0,
        classifyDefinitions: true,
      });
      if (!search.ok) throw new Error(search.error);

      const result = search.value;
      let output = formatGrepOutput(result);
      if (result.nextCursor) output += `\n\n[Continue with cursor="${cursorStore.storeGrep(result.nextCursor)}"]`;

      return {
        content: [{ type: "text" as const, text: output }],
        details: { totalMatched: result.totalMatched, totalFiles: result.totalFiles, patterns: params.patterns },
      };
    },

    renderCall(args: Partial<MultiGrepParams> | undefined, theme, context) {
      const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      const patterns = args?.patterns ?? [];
      let content = `${theme.fg("toolTitle", theme.bold("multi_grep"))} ${theme.fg("accent", patterns.map((pattern) => `"${pattern}"`).join(", "))}`;
      if (args?.constraints) content += theme.fg("toolOutput", ` (${args.constraints})`);
      if (args?.cursor) content += theme.fg("muted", " (page)");
      text.setText(content);
      return text;
    },

    renderResult(result, options, theme, context) {
      return renderTextResult(result, options, theme, context, 15);
    },
  });
}

function hasRegexSyntax(pattern: string): boolean {
  return pattern !== pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function positiveLimit(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.floor(value ?? fallback));
}

function cwdForTool(ctx: unknown, getActiveCwd: CwdProvider): string {
  const candidate = (ctx as { cwd?: unknown } | undefined)?.cwd;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : getActiveCwd();
}
