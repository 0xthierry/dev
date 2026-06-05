#!/usr/bin/env bun
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

interface Options {
  days: number;
  allTime: boolean;
  json: boolean;
  codexHome?: string;
  explicitSessionDirs: string[];
}

interface CodexTokenUsage {
  input_tokens?: unknown;
  cached_input_tokens?: unknown;
  output_tokens?: unknown;
  reasoning_output_tokens?: unknown;
  total_tokens?: unknown;
}

interface RateLimitWindow {
  used_percent?: unknown;
  window_minutes?: unknown;
  resets_at?: unknown;
}

interface RateLimits {
  limit_id?: unknown;
  limit_name?: unknown;
  primary?: RateLimitWindow;
  secondary?: RateLimitWindow;
  credits?: unknown;
  individual_limit?: unknown;
  plan_type?: unknown;
  rate_limit_reached_type?: unknown;
}

interface SessionMetaPayload {
  cwd?: unknown;
  id?: unknown;
  model_provider?: unknown;
  model?: unknown;
}

interface TurnContextPayload {
  cwd?: unknown;
  model?: unknown;
  collaboration_mode?: {
    settings?: {
      model?: unknown;
    };
  };
}

interface TokenCountPayload {
  info?: {
    last_token_usage?: CodexTokenUsage;
    total_token_usage?: CodexTokenUsage;
  };
  rate_limits?: RateLimits;
}

interface SessionEntry {
  type?: unknown;
  timestamp?: unknown;
  payload?: unknown;
}

interface Totals {
  calls: number;
  input: number;
  cachedInput: number;
  output: number;
  reasoningOutput: number;
  totalTokens: number;
}

interface Bucket {
  label: string;
  totals: Totals;
  sessions: Set<string>;
}

interface SessionFileStats {
  file: string;
  cwd: string | null;
  calls: number;
  totals: Totals;
}

interface RateLimitSnapshot {
  timestamp: Date;
  limits: RateLimits;
}

interface ScanResult {
  roots: string[];
  missingRoots: string[];
  filesScanned: number;
  sessionsWithUsage: number;
  parseErrors: number;
  total: Totals;
  daily: Map<string, Bucket>;
  weekdays: Map<string, Bucket>;
  models: Map<string, Bucket>;
  sessions: SessionFileStats[];
  latestRateLimits: RateLimitSnapshot | null;
}

interface DateRange {
  since: Date;
  untilExclusive: Date;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options === null) return;

  scan(options)
    .then((result) => {
      if (options.json) {
        console.log(JSON.stringify(toJson(result, options), null, 2));
        return;
      }
      printReport(result, options);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

function parseArgs(args: string[]): Options | null {
  const options: Options = {
    days: 30,
    allTime: false,
    json: false,
    explicitSessionDirs: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      return null;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--all-time") {
      options.allTime = true;
      continue;
    }
    if (arg === "--days") {
      options.days = parsePositiveInteger(readRequiredValue(args, ++index, arg), arg);
      continue;
    }
    if (arg.startsWith("--days=")) {
      options.days = parsePositiveInteger(arg.slice("--days=".length), "--days");
      continue;
    }
    if (arg === "--codex-home") {
      options.codexHome = expandPath(readRequiredValue(args, ++index, arg));
      continue;
    }
    if (arg.startsWith("--codex-home=")) {
      options.codexHome = expandPath(arg.slice("--codex-home=".length));
      continue;
    }
    if (arg === "--sessions-dir") {
      options.explicitSessionDirs.push(expandPath(readRequiredValue(args, ++index, arg)));
      continue;
    }
    if (arg.startsWith("--sessions-dir=")) {
      options.explicitSessionDirs.push(expandPath(arg.slice("--sessions-dir=".length)));
      continue;
    }

    throw new Error(`Unknown argument: ${arg}. Run scripts/codex-session-usage.ts --help for usage.`);
  }

  return options;
}

function printHelp(): void {
  console.log(`Codex session usage report

Usage:
  bun scripts/codex-session-usage.ts [options]
  bun run codex:usage -- [options]

Options:
  --days N             Calendar days to include, including today. Default: 30.
  --all-time           Include every saved Codex token_count entry instead of the last N days.
  --sessions-dir PATH  Session root to scan. Can be repeated. Defaults to ~/.codex/sessions.
  --codex-home PATH    Codex home used for defaults. Defaults to CODEX_HOME or ~/.codex.
  --json               Print machine-readable JSON.
  -h, --help           Show this help.

Notes:
  - Usage is summed from saved Codex token_count info.last_token_usage values.
  - Cost is not shown because Codex session logs do not save per-call pricing.
`);
}

async function scan(options: Options): Promise<ScanResult> {
  const roots = defaultSessionRoots(options);
  const range = dateRange(options);
  const daily = makeDailyBuckets(range, options.allTime);
  const weekdays = makeWeekdayBuckets();
  const models = new Map<string, Bucket>();
  const sessions: SessionFileStats[] = [];
  const result: ScanResult = {
    roots,
    missingRoots: [],
    filesScanned: 0,
    sessionsWithUsage: 0,
    parseErrors: 0,
    total: emptyTotals(),
    daily,
    weekdays,
    models,
    sessions,
    latestRateLimits: null,
  };

  for (const root of roots) {
    const files = await findJsonlFiles(root);
    if (files === null) {
      result.missingRoots.push(root);
      continue;
    }

    for (const file of files) {
      result.filesScanned += 1;
      const fileStats = await scanSessionFile(file, range, result);
      if (fileStats.calls > 0) {
        result.sessionsWithUsage += 1;
        sessions.push(fileStats);
      }
    }
  }

  sessions.sort((a, b) => b.totals.totalTokens - a.totals.totalTokens || b.totals.calls - a.totals.calls);
  return result;
}

async function scanSessionFile(file: string, range: DateRange, result: ScanResult): Promise<SessionFileStats> {
  let cwd: string | null = null;
  let provider = "unknown-provider";
  let model = "unknown-model";
  const fileTotals = emptyTotals();
  const stream = createReadStream(file, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  for await (const line of lines) {
    if (!line.trim()) continue;

    let entry: SessionEntry;
    try {
      entry = JSON.parse(line) as SessionEntry;
    } catch {
      result.parseErrors += 1;
      continue;
    }

    if (entry.type === "session_meta") {
      const payload = objectPayload<SessionMetaPayload>(entry.payload);
      cwd = typeof payload.cwd === "string" ? payload.cwd : cwd;
      provider = typeof payload.model_provider === "string" && payload.model_provider ? payload.model_provider : provider;
      model = typeof payload.model === "string" && payload.model ? payload.model : model;
      continue;
    }

    if (entry.type === "turn_context") {
      const payload = objectPayload<TurnContextPayload>(entry.payload);
      cwd = typeof payload.cwd === "string" ? payload.cwd : cwd;
      const contextModel = payload.model ?? payload.collaboration_mode?.settings?.model;
      model = typeof contextModel === "string" && contextModel ? contextModel : model;
      continue;
    }

    if (entry.type !== "event_msg") continue;
    const payload = objectPayload<{ type?: unknown }>(entry.payload);
    if (payload.type !== "token_count") continue;

    const timestamp = entryTimestamp(entry);
    if (!timestamp || timestamp < range.since || timestamp >= range.untilExclusive) continue;

    const tokenPayload = objectPayload<TokenCountPayload>(entry.payload);
    const usage = normalizeUsage(tokenPayload.info?.last_token_usage ?? tokenPayload.info?.total_token_usage);
    if (usage.calls === 0) continue;

    const dateKey = localDateKey(timestamp);
    const weekday = WEEKDAYS[timestamp.getDay()];
    const modelName = `${provider}/${model}`;

    addTotals(result.total, usage);
    addTotals(fileTotals, usage);
    addToBucket(getOrCreateBucket(result.daily, dateKey), usage, file);
    addToBucket(getOrCreateBucket(result.weekdays, weekday), usage, file);
    addToBucket(getOrCreateBucket(result.models, modelName), usage, file);
    updateLatestRateLimits(result, timestamp, tokenPayload.rate_limits);
  }

  return { file, cwd, calls: fileTotals.calls, totals: fileTotals };
}

function defaultSessionRoots(options: Options): string[] {
  if (options.explicitSessionDirs.length > 0) return unique(options.explicitSessionDirs.map((dir) => resolve(dir)));

  const codexHome = resolve(options.codexHome ?? expandPath(process.env.CODEX_HOME ?? join(homedir(), ".codex")));
  return [join(codexHome, "sessions")];
}

async function findJsonlFiles(root: string): Promise<string[] | null> {
  const files: string[] = [];

  async function walk(directory: string): Promise<boolean> {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return false;
    }

    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }
      if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".jsonl")) files.push(path);
    }
    return true;
  }

  const foundRoot = await walk(root);
  if (!foundRoot) return null;
  return files.sort();
}

function dateRange(options: Options): DateRange {
  if (options.allTime) {
    return {
      since: new Date(-8_640_000_000_000_000),
      untilExclusive: new Date(8_640_000_000_000_000),
    };
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    since: new Date(today.getTime() - (options.days - 1) * DAY_MS),
    untilExclusive: new Date(today.getTime() + DAY_MS),
  };
}

function makeDailyBuckets(range: DateRange, allTime: boolean): Map<string, Bucket> {
  const buckets = new Map<string, Bucket>();
  if (allTime) return buckets;

  for (let time = range.since.getTime(); time < range.untilExclusive.getTime(); time += DAY_MS) {
    const date = new Date(time);
    const key = localDateKey(date);
    buckets.set(key, { label: key, totals: emptyTotals(), sessions: new Set() });
  }
  return buckets;
}

function makeWeekdayBuckets(): Map<string, Bucket> {
  return new Map(WEEKDAYS.map((weekday) => [weekday, { label: weekday, totals: emptyTotals(), sessions: new Set<string>() }]));
}

function emptyTotals(): Totals {
  return {
    calls: 0,
    input: 0,
    cachedInput: 0,
    output: 0,
    reasoningOutput: 0,
    totalTokens: 0,
  };
}

function normalizeUsage(usage?: CodexTokenUsage): Totals {
  if (!usage) return emptyTotals();
  const input = numberValue(usage.input_tokens);
  const cachedInput = numberValue(usage.cached_input_tokens);
  const output = numberValue(usage.output_tokens);
  const reasoningOutput = numberValue(usage.reasoning_output_tokens);
  const totalTokens = numberValue(usage.total_tokens) || input + output;
  if (input + cachedInput + output + reasoningOutput + totalTokens === 0) return emptyTotals();

  return {
    calls: 1,
    input,
    cachedInput,
    output,
    reasoningOutput,
    totalTokens,
  };
}

function addTotals(target: Totals, usage: Totals): void {
  target.calls += usage.calls;
  target.input += usage.input;
  target.cachedInput += usage.cachedInput;
  target.output += usage.output;
  target.reasoningOutput += usage.reasoningOutput;
  target.totalTokens += usage.totalTokens;
}

function addToBucket(bucket: Bucket, usage: Totals, file: string): void {
  addTotals(bucket.totals, usage);
  bucket.sessions.add(file);
}

function getOrCreateBucket(buckets: Map<string, Bucket>, label: string): Bucket {
  let bucket = buckets.get(label);
  if (!bucket) {
    bucket = { label, totals: emptyTotals(), sessions: new Set() };
    buckets.set(label, bucket);
  }
  return bucket;
}

function updateLatestRateLimits(result: ScanResult, timestamp: Date, limits?: RateLimits): void {
  if (!limits) return;
  if (!result.latestRateLimits || timestamp > result.latestRateLimits.timestamp) {
    result.latestRateLimits = { timestamp, limits };
  }
}

function entryTimestamp(entry: SessionEntry): Date | null {
  if (typeof entry.timestamp !== "string") return null;
  const date = new Date(entry.timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

function printReport(result: ScanResult, options: Options): void {
  const range = dateRange(options);
  const rangeLabel = options.allTime
    ? "all time"
    : `${options.days} days (${localDateKey(range.since)} through ${localDateKey(new Date(range.untilExclusive.getTime() - 1))})`;

  console.log(`Codex session usage — ${rangeLabel}`);
  console.log("\nScanned roots:");
  for (const root of result.roots) console.log(`  - ${root}`);
  for (const root of result.missingRoots) console.log(`  - ${root} (missing)`);

  console.log("\nTotals:");
  console.log(`  Tokens:        ${formatTokenCount(result.total.totalTokens)}`);
  console.log(`  Input:         ${formatTokenCount(result.total.input)}`);
  console.log(`  Cached input:  ${formatTokenCount(result.total.cachedInput)}`);
  console.log(`  Output:        ${formatTokenCount(result.total.output)}`);
  console.log(`  Reasoning:     ${formatTokenCount(result.total.reasoningOutput)}`);
  console.log(`  Model calls:   ${formatInteger(result.total.calls)}`);
  console.log(`  Session files: ${formatInteger(result.sessionsWithUsage)} with usage / ${formatInteger(result.filesScanned)} scanned`);
  if (result.parseErrors > 0) console.log(`  Parse errors:  ${formatInteger(result.parseErrors)} malformed JSONL lines skipped`);

  printRateLimits(result.latestRateLimits);
  printDailyTable(result.daily);
  printWeekdayTable(result.weekdays, options);
  printModelTable(result.models);
  printTopSessions(result.sessions);

  console.log("\nNote: usage comes from saved Codex token_count info.last_token_usage values; Codex logs do not include per-call cost.");
}

function printRateLimits(snapshot: RateLimitSnapshot | null): void {
  if (!snapshot) return;

  const rows = [
    rateLimitRow("Primary", snapshot.limits.primary),
    rateLimitRow("Secondary", snapshot.limits.secondary),
  ].filter((row): row is string[] => row !== null);

  printTable(`\nLatest rate limits (${formatDateTime(snapshot.timestamp)})`, ["Window", "Used", "Length", "Resets at"], rows, 1);
}

function rateLimitRow(label: string, window?: RateLimitWindow): string[] | null {
  if (!window) return null;
  const usedPercent = numberValue(window.used_percent);
  const windowMinutes = numberValue(window.window_minutes);
  const resetsAt = numberValue(window.resets_at);
  return [
    label,
    usedPercent > 0 ? `${formatCompact(usedPercent)}%` : "0%",
    windowMinutes > 0 ? `${formatInteger(windowMinutes)}m` : "unknown",
    resetsAt > 0 ? formatDateTime(new Date(resetsAt * 1000)) : "unknown",
  ];
}

function printDailyTable(daily: Map<string, Bucket>): void {
  const rows = [...daily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bucket]) => {
      const parsed = new Date(`${date}T00:00:00`);
      return [
        date,
        WEEKDAYS[parsed.getDay()],
        formatInteger(bucket.totals.calls),
        formatInteger(bucket.sessions.size),
        formatTokenCount(bucket.totals.input),
        formatTokenCount(bucket.totals.cachedInput),
        formatTokenCount(bucket.totals.output),
        formatTokenCount(bucket.totals.reasoningOutput),
        formatTokenCount(bucket.totals.totalTokens),
      ];
    });

  printTable("\nDaily totals", ["Date", "Weekday", "Calls", "Sessions", "Input", "Cached", "Output", "Reasoning", "Tokens"], rows, 2);
}

function printWeekdayTable(weekdays: Map<string, Bucket>, options: Options): void {
  const calendarDaysByWeekday = countCalendarDaysByWeekday(options);
  const rows = WEEKDAYS.map((weekday) => {
    const bucket = weekdays.get(weekday) ?? { label: weekday, totals: emptyTotals(), sessions: new Set<string>() };
    const days = calendarDaysByWeekday.get(weekday) ?? 0;
    const averageTokens = days > 0 ? bucket.totals.totalTokens / days : bucket.totals.totalTokens;
    return [
      weekday,
      options.allTime ? "—" : formatInteger(days),
      formatInteger(bucket.totals.calls),
      formatInteger(bucket.sessions.size),
      formatTokenCount(bucket.totals.totalTokens),
      options.allTime ? "—" : formatTokenCount(averageTokens),
    ];
  });

  printTable("\nBy weekday", ["Weekday", "Days", "Calls", "Sessions", "Tokens", "Avg/day"], rows, 2);
}

function printModelTable(models: Map<string, Bucket>): void {
  const rows = [...models.values()]
    .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens || b.totals.calls - a.totals.calls)
    .slice(0, 12)
    .map((bucket) => [bucket.label, formatInteger(bucket.totals.calls), formatTokenCount(bucket.totals.totalTokens)]);

  printTable("\nBy model (top 12 by tokens)", ["Model", "Calls", "Tokens"], rows, 2);
}

function printTopSessions(sessions: SessionFileStats[]): void {
  const rows = sessions.slice(0, 12).map((session) => [
    basename(session.file),
    session.cwd ?? "unknown cwd",
    formatInteger(session.calls),
    formatTokenCount(session.totals.totalTokens),
  ]);

  printTable("\nTop sessions (top 12 by tokens)", ["File", "Cwd", "Calls", "Tokens"], rows, 2);
}

function printTable(title: string, headers: string[], rows: string[][], numericColumnsFrom = 0): void {
  console.log(title);
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }

  const widths = headers.map((header, index) => {
    const rowWidth = Math.max(...rows.map((row) => visibleLength(row[index] ?? "")));
    return Math.max(visibleLength(header), rowWidth);
  });
  const numericIndexes = new Set(headers.slice(numericColumnsFrom).map((_, index) => index + numericColumnsFrom));
  const formatCell = (value: string, index: number) =>
    numericIndexes.has(index) ? value.padStart(widths[index]) : value.padEnd(widths[index]);

  console.log(`  ${headers.map(formatCell).join("  ")}`);
  console.log(`  ${widths.map((width) => "─".repeat(width)).join("  ")}`);
  for (const row of rows) console.log(`  ${row.map(formatCell).join("  ")}`);
}

function countCalendarDaysByWeekday(options: Options): Map<string, number> {
  const counts = new Map(WEEKDAYS.map((weekday) => [weekday, 0]));
  if (options.allTime) return counts;

  const range = dateRange(options);
  for (let time = range.since.getTime(); time < range.untilExclusive.getTime(); time += DAY_MS) {
    const date = new Date(time);
    const weekday = WEEKDAYS[date.getDay()];
    counts.set(weekday, (counts.get(weekday) ?? 0) + 1);
  }
  return counts;
}

function toJson(result: ScanResult, options: Options): unknown {
  return {
    range: options.allTime
      ? { allTime: true }
      : {
          allTime: false,
          days: options.days,
          since: dateRange(options).since.toISOString(),
          untilExclusive: dateRange(options).untilExclusive.toISOString(),
        },
    roots: result.roots,
    missingRoots: result.missingRoots,
    filesScanned: result.filesScanned,
    sessionsWithUsage: result.sessionsWithUsage,
    parseErrors: result.parseErrors,
    totals: totalsJson(result.total),
    daily: [...result.daily.values()].map(bucketJson),
    weekdays: WEEKDAYS.map((weekday) => bucketJson(result.weekdays.get(weekday) ?? { label: weekday, totals: emptyTotals(), sessions: new Set() })),
    models: [...result.models.values()]
      .sort((a, b) => b.totals.totalTokens - a.totals.totalTokens || b.totals.calls - a.totals.calls)
      .map(bucketJson),
    sessions: result.sessions.map((session) => ({
      file: session.file,
      cwd: session.cwd,
      calls: session.calls,
      totals: totalsJson(session.totals),
    })),
    latestRateLimits: result.latestRateLimits
      ? {
          timestamp: result.latestRateLimits.timestamp.toISOString(),
          limits: result.latestRateLimits.limits,
        }
      : null,
  };
}

function bucketJson(bucket: Bucket): unknown {
  return {
    label: bucket.label,
    sessions: bucket.sessions.size,
    totals: totalsJson(bucket.totals),
  };
}

function totalsJson(totals: Totals): unknown {
  return {
    calls: totals.calls,
    tokens: {
      input: totals.input,
      cachedInput: totals.cachedInput,
      output: totals.output,
      reasoningOutput: totals.reasoningOutput,
      total: totals.totalTokens,
    },
  };
}

function objectPayload<T extends object>(value: unknown): Partial<T> {
  return typeof value === "object" && value !== null ? (value as Partial<T>) : {};
}

function readRequiredValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

function expandPath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function formatTokenCount(value: number): string {
  const rounded = Math.round(value);
  const abs = Math.abs(rounded);
  if (abs >= 1_000_000_000) return `${formatCompact(rounded / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${formatCompact(rounded / 1_000_000)}M`;
  if (abs >= 1_000) return `${formatCompact(rounded / 1_000)}K`;
  return formatInteger(rounded);
}

function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const fixed = abs >= 100 ? value.toFixed(0) : abs >= 10 ? value.toFixed(1) : value.toFixed(2);
  return fixed.replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function formatDateTime(date: Date): string {
  return `${localDateKey(date)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function visibleLength(value: string): number {
  return value.length;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

main();
