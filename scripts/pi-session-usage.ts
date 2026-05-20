#!/usr/bin/env bun
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

interface Options {
  days: number;
  allTime: boolean;
  json: boolean;
  dedupe: boolean;
  primaryOnly: boolean;
  agentDir?: string;
  explicitSessionDirs: string[];
}

interface UsageCost {
  input?: unknown;
  output?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
  total?: unknown;
}

interface UsageShape {
  input?: unknown;
  output?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
  totalTokens?: unknown;
  cost?: UsageCost;
}

interface SessionHeader {
  cwd?: unknown;
  id?: unknown;
  timestamp?: unknown;
}

interface AssistantMessage {
  role?: unknown;
  provider?: unknown;
  model?: unknown;
  usage?: UsageShape;
  timestamp?: unknown;
  responseId?: unknown;
}

interface SessionEntry {
  type?: unknown;
  id?: unknown;
  timestamp?: unknown;
  cwd?: unknown;
  message?: AssistantMessage;
}

interface Totals {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  costInput: number;
  costOutput: number;
  costCacheRead: number;
  costCacheWrite: number;
  costTotal: number;
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

interface ScanResult {
  roots: string[];
  missingRoots: string[];
  filesScanned: number;
  sessionsWithUsage: number;
  parseErrors: number;
  duplicateCallsSkipped: number;
  total: Totals;
  daily: Map<string, Bucket>;
  weekdays: Map<string, Bucket>;
  models: Map<string, Bucket>;
  sessions: SessionFileStats[];
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
    dedupe: true,
    primaryOnly: false,
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
    if (arg === "--no-dedupe") {
      options.dedupe = false;
      continue;
    }
    if (arg === "--primary-only") {
      options.primaryOnly = true;
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
    if (arg === "--agent-dir") {
      options.agentDir = expandPath(readRequiredValue(args, ++index, arg));
      continue;
    }
    if (arg.startsWith("--agent-dir=")) {
      options.agentDir = expandPath(arg.slice("--agent-dir=".length));
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

    throw new Error(`Unknown argument: ${arg}. Run scripts/pi-session-usage.ts --help for usage.`);
  }

  return options;
}

function printHelp(): void {
  console.log(`Pi session usage report

Usage:
  bun scripts/pi-session-usage.ts [options]
  bun run pi:usage -- [options]

Options:
  --days N             Calendar days to include, including today. Default: 30.
  --all-time           Include every saved assistant usage entry instead of the last N days.
  --sessions-dir PATH  Session root to scan. Can be repeated. Defaults to Pi sessions plus subagent sessions.
  --agent-dir PATH     Pi agent directory used for defaults. Defaults to PI_CODING_AGENT_DIR or ~/.pi/agent.
  --primary-only       Scan only primary Pi sessions, excluding subagent sessions.
  --no-dedupe          Do not deduplicate copied/forked model responses.
  --json               Print machine-readable JSON.
  -h, --help           Show this help.

Notes:
  - Cost is read from saved Pi assistant usage.cost.total values; prices are not recalculated.
  - Default scanning includes ~/.pi/agent/sessions and ~/.pi/agent/agent-sessions when present.
`);
}

async function scan(options: Options): Promise<ScanResult> {
  const roots = defaultSessionRoots(options);
  const range = dateRange(options);
  const daily = makeDailyBuckets(range, options.allTime);
  const weekdays = makeWeekdayBuckets();
  const models = new Map<string, Bucket>();
  const seenCalls = new Set<string>();
  const sessions: SessionFileStats[] = [];
  const result: ScanResult = {
    roots,
    missingRoots: [],
    filesScanned: 0,
    sessionsWithUsage: 0,
    parseErrors: 0,
    duplicateCallsSkipped: 0,
    total: emptyTotals(),
    daily,
    weekdays,
    models,
    sessions,
  };

  for (const root of roots) {
    const files = await findJsonlFiles(root);
    if (files === null) {
      result.missingRoots.push(root);
      continue;
    }

    for (const file of files) {
      result.filesScanned += 1;
      const fileStats = await scanSessionFile(file, range, options, seenCalls, result);
      if (fileStats.calls > 0) {
        result.sessionsWithUsage += 1;
        sessions.push(fileStats);
      }
    }
  }

  sessions.sort((a, b) => b.totals.costTotal - a.totals.costTotal || b.totals.totalTokens - a.totals.totalTokens);
  return result;
}

async function scanSessionFile(
  file: string,
  range: DateRange,
  options: Options,
  seenCalls: Set<string>,
  result: ScanResult,
): Promise<SessionFileStats> {
  let cwd: string | null = null;
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

    if (entry.type === "session") {
      const header = entry as SessionHeader;
      cwd = typeof header.cwd === "string" ? header.cwd : null;
      continue;
    }

    if (entry.type !== "message" || entry.message?.role !== "assistant" || !entry.message.usage) continue;

    const timestamp = entryTimestamp(entry);
    if (!timestamp || timestamp < range.since || timestamp >= range.untilExclusive) continue;

    const callKey = modelCallKey(entry, file);
    if (options.dedupe && seenCalls.has(callKey)) {
      result.duplicateCallsSkipped += 1;
      continue;
    }
    seenCalls.add(callKey);

    const usage = normalizeUsage(entry.message.usage);
    const dateKey = localDateKey(timestamp);
    const weekday = WEEKDAYS[timestamp.getDay()];
    const model = modelLabel(entry.message);

    addTotals(result.total, usage);
    addTotals(fileTotals, usage);
    addToBucket(getOrCreateBucket(result.daily, dateKey), usage, file);
    addToBucket(getOrCreateBucket(result.weekdays, weekday), usage, file);
    addToBucket(getOrCreateBucket(result.models, model), usage, file);
  }

  return { file, cwd, calls: fileTotals.calls, totals: fileTotals };
}

function defaultSessionRoots(options: Options): string[] {
  if (options.explicitSessionDirs.length > 0) return unique(options.explicitSessionDirs.map((dir) => resolve(dir)));

  const agentDir = resolve(
    options.agentDir ??
      expandPath(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent")),
  );
  const primary = expandPath(process.env.PI_CODING_AGENT_SESSION_DIR ?? join(agentDir, "sessions"));
  const roots = [resolve(primary)];
  if (!options.primaryOnly) roots.push(join(agentDir, "agent-sessions"));
  return unique(roots);
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
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    costInput: 0,
    costOutput: 0,
    costCacheRead: 0,
    costCacheWrite: 0,
    costTotal: 0,
  };
}

function normalizeUsage(usage: UsageShape): Totals {
  const input = numberValue(usage.input);
  const output = numberValue(usage.output);
  const cacheRead = numberValue(usage.cacheRead);
  const cacheWrite = numberValue(usage.cacheWrite);
  return {
    calls: 1,
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: numberValue(usage.totalTokens) || input + output + cacheRead + cacheWrite,
    costInput: numberValue(usage.cost?.input),
    costOutput: numberValue(usage.cost?.output),
    costCacheRead: numberValue(usage.cost?.cacheRead),
    costCacheWrite: numberValue(usage.cost?.cacheWrite),
    costTotal: numberValue(usage.cost?.total),
  };
}

function addTotals(target: Totals, usage: Totals): void {
  target.calls += usage.calls;
  target.input += usage.input;
  target.output += usage.output;
  target.cacheRead += usage.cacheRead;
  target.cacheWrite += usage.cacheWrite;
  target.totalTokens += usage.totalTokens;
  target.costInput += usage.costInput;
  target.costOutput += usage.costOutput;
  target.costCacheRead += usage.costCacheRead;
  target.costCacheWrite += usage.costCacheWrite;
  target.costTotal += usage.costTotal;
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

function entryTimestamp(entry: SessionEntry): Date | null {
  if (typeof entry.timestamp === "string") {
    const date = new Date(entry.timestamp);
    if (!Number.isNaN(date.getTime())) return date;
  }

  if (typeof entry.message?.timestamp === "number") {
    const date = new Date(entry.message.timestamp);
    if (!Number.isNaN(date.getTime())) return date;
  }

  return null;
}

function modelCallKey(entry: SessionEntry, file: string): string {
  if (typeof entry.message?.responseId === "string" && entry.message.responseId.trim()) {
    return `response:${entry.message.responseId}`;
  }

  const stablePayload = JSON.stringify({
    id: entry.id,
    timestamp: entry.timestamp,
    messageTimestamp: entry.message?.timestamp,
    provider: entry.message?.provider,
    model: entry.message?.model,
    usage: entry.message?.usage,
  });
  const hash = createHash("sha1").update(stablePayload).digest("hex");
  return `entry:${hash}:${fileFallbackScope(entry, file)}`;
}

function fileFallbackScope(entry: SessionEntry, file: string): string {
  return typeof entry.id === "string" && entry.id ? "copied-entry" : file;
}

function modelLabel(message: AssistantMessage): string {
  const provider = typeof message.provider === "string" && message.provider ? message.provider : "unknown-provider";
  const model = typeof message.model === "string" && message.model ? message.model : "unknown-model";
  return `${provider}/${model}`;
}

function printReport(result: ScanResult, options: Options): void {
  const range = dateRange(options);
  const rangeLabel = options.allTime
    ? "all time"
    : `${options.days} days (${localDateKey(range.since)} through ${localDateKey(new Date(range.untilExclusive.getTime() - 1))})`;

  console.log(`Pi session usage — ${rangeLabel}`);
  console.log("\nScanned roots:");
  for (const root of result.roots) console.log(`  - ${root}`);
  for (const root of result.missingRoots) console.log(`  - ${root} (missing)`);

  console.log("\nTotals:");
  console.log(`  Cost:          ${formatMoney(result.total.costTotal)}`);
  console.log(`  Tokens:        ${formatTokenCount(result.total.totalTokens)}`);
  console.log(`  Input:         ${formatTokenCount(result.total.input)}`);
  console.log(`  Output:        ${formatTokenCount(result.total.output)}`);
  console.log(`  Cache read:    ${formatTokenCount(result.total.cacheRead)}`);
  console.log(`  Cache write:   ${formatTokenCount(result.total.cacheWrite)}`);
  console.log(`  Model calls:   ${formatInteger(result.total.calls)}`);
  console.log(`  Session files: ${formatInteger(result.sessionsWithUsage)} with usage / ${formatInteger(result.filesScanned)} scanned`);
  if (options.dedupe) console.log(`  Duplicates:    ${formatInteger(result.duplicateCallsSkipped)} skipped`);
  if (result.parseErrors > 0) console.log(`  Parse errors:  ${formatInteger(result.parseErrors)} malformed JSONL lines skipped`);

  printDailyTable(result.daily);
  printWeekdayTable(result.weekdays, options);
  printModelTable(result.models);
  printTopSessions(result.sessions);

  console.log("\nNote: cost comes from saved Pi usage.cost.total values; this script does not recalculate provider pricing.");
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
        formatTokenCount(bucket.totals.output),
        formatTokenCount(bucket.totals.cacheRead + bucket.totals.cacheWrite),
        formatTokenCount(bucket.totals.totalTokens),
        formatMoney(bucket.totals.costTotal),
      ];
    });

  printTable("\nDaily totals", ["Date", "Weekday", "Calls", "Sessions", "Input", "Output", "Cache", "Tokens", "Cost"], rows, 2);
}

function printWeekdayTable(weekdays: Map<string, Bucket>, options: Options): void {
  const calendarDaysByWeekday = countCalendarDaysByWeekday(options);
  const rows = WEEKDAYS.map((weekday) => {
    const bucket = weekdays.get(weekday) ?? { label: weekday, totals: emptyTotals(), sessions: new Set<string>() };
    const days = calendarDaysByWeekday.get(weekday) ?? 0;
    const averageCost = days > 0 ? bucket.totals.costTotal / days : bucket.totals.costTotal;
    return [
      weekday,
      options.allTime ? "—" : formatInteger(days),
      formatInteger(bucket.totals.calls),
      formatInteger(bucket.sessions.size),
      formatTokenCount(bucket.totals.totalTokens),
      formatMoney(bucket.totals.costTotal),
      options.allTime ? "—" : formatMoney(averageCost),
    ];
  });

  printTable("\nBy weekday", ["Weekday", "Days", "Calls", "Sessions", "Tokens", "Cost", "Avg/day"], rows, 2);
}

function printModelTable(models: Map<string, Bucket>): void {
  const rows = [...models.values()]
    .sort((a, b) => b.totals.costTotal - a.totals.costTotal || b.totals.totalTokens - a.totals.totalTokens)
    .slice(0, 12)
    .map((bucket) => [
      bucket.label,
      formatInteger(bucket.totals.calls),
      formatTokenCount(bucket.totals.totalTokens),
      formatMoney(bucket.totals.costTotal),
    ]);

  printTable("\nBy model (top 12 by cost)", ["Model", "Calls", "Tokens", "Cost"], rows, 2);
}

function printTopSessions(sessions: SessionFileStats[]): void {
  const rows = sessions.slice(0, 12).map((session) => [
    basename(session.file),
    session.cwd ?? "unknown cwd",
    formatInteger(session.calls),
    formatTokenCount(session.totals.totalTokens),
    formatMoney(session.totals.costTotal),
  ]);

  printTable("\nTop sessions (top 12 by cost)", ["File", "Cwd", "Calls", "Tokens", "Cost"], rows, 2);
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
    duplicateCallsSkipped: result.duplicateCallsSkipped,
    totals: totalsJson(result.total),
    daily: [...result.daily.values()].map(bucketJson),
    weekdays: WEEKDAYS.map((weekday) => bucketJson(result.weekdays.get(weekday) ?? { label: weekday, totals: emptyTotals(), sessions: new Set() })),
    models: [...result.models.values()]
      .sort((a, b) => b.totals.costTotal - a.totals.costTotal || b.totals.totalTokens - a.totals.totalTokens)
      .map(bucketJson),
    sessions: result.sessions.map((session) => ({
      file: session.file,
      cwd: session.cwd,
      calls: session.calls,
      totals: totalsJson(session.totals),
    })),
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
      output: totals.output,
      cacheRead: totals.cacheRead,
      cacheWrite: totals.cacheWrite,
      total: totals.totalTokens,
    },
    cost: {
      input: roundMoney(totals.costInput),
      output: roundMoney(totals.costOutput),
      cacheRead: roundMoney(totals.costCacheRead),
      cacheWrite: roundMoney(totals.costCacheWrite),
      total: roundMoney(totals.costTotal),
    },
  };
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

function formatMoney(value: number): string {
  return `$${roundMoney(value).toFixed(4)}`;
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

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function visibleLength(value: string): number {
  return value.length;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

main();
