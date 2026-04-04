const input = await Bun.stdin.text();

interface StatusData {
  cwd?: string;
  model?: { id?: string; display_name?: string };
  workspace?: { current_dir?: string; project_dir?: string };
  cost?: {
    total_cost_usd?: number;
    total_duration_ms?: number;
    total_api_duration_ms?: number;
    total_lines_added?: number;
    total_lines_removed?: number;
  };
  context_window?: {
    total_input_tokens?: number;
    total_output_tokens?: number;
    context_window_size?: number;
    used_percentage?: number | null;
    remaining_percentage?: number | null;
    current_usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    } | null;
  };
  exceeds_200k_tokens?: boolean;
  agent?: { name?: string } | null;
  vim?: { mode?: string } | null;
  version?: string;
}

const data: StatusData = JSON.parse(input);

const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
const green = (s: string) => `\x1b[32m${s}\x1b[39m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[39m`;
const red = (s: string) => `\x1b[31m${s}\x1b[39m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[39m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[39m`;

function formatTokens(n?: number): string {
  if (n == null) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms?: number): string {
  if (ms == null) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m${sec.toString().padStart(2, "0")}s`;
}

function formatCost(usd?: number): string {
  if (usd == null) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function contextBar(pct?: number | null): string {
  if (pct == null) return dim("---%");
  const width = 10;
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const colorize = pct > 60 ? red : pct >= 40 ? yellow : green;
  return colorize(bar) + " " + colorize(`${pct}%`);
}

async function gitBranch(cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
    });
    const out = await new Response(proc.stdout).text();
    return out.trim() || null;
  } catch {
    return null;
  }
}

function shortenPath(p: string): string {
  const home = Bun.env.HOME ?? "";
  if (home && p.startsWith(home)) {
    p = "~" + p.slice(home.length);
  }
  const parts = p.split("/");
  if (parts.length <= 3) return p;
  return parts.slice(0, 1).concat("…", parts.slice(-2)).join("/");
}

const cwd = data.cwd ?? data.workspace?.current_dir ?? "";
const branch = cwd ? await gitBranch(cwd) : null;

const parts: string[] = [];

// Model
const model = data.model?.display_name ?? data.model?.id ?? "?";
parts.push(bold(cyan(model)));

// Agent (if present)
if (data.agent?.name) {
  parts.push(magenta(`agent:${data.agent.name}`));
}

// Branch
if (branch) {
  parts.push(magenta(branch));
}

// Working directory
if (cwd) {
  parts.push(cyan(shortenPath(cwd)));
}

// Cost
parts.push(green(formatCost(data.cost?.total_cost_usd)));

// Context bar
parts.push(contextBar(data.context_window?.used_percentage));

// Token breakdown
const ctx = data.context_window;
const usage = ctx?.current_usage;
const inTok = formatTokens(ctx?.total_input_tokens);
const outTok = formatTokens(ctx?.total_output_tokens);
const cacheR = formatTokens(usage?.cache_read_input_tokens);
const cacheW = formatTokens(usage?.cache_creation_input_tokens);
parts.push(dim(`in:${inTok} out:${outTok} cr:${cacheR} cw:${cacheW}`));

// Lines changed
const added = data.cost?.total_lines_added ?? 0;
const removed = data.cost?.total_lines_removed ?? 0;
if (added > 0 || removed > 0) {
  parts.push(`${green(`+${added}`)}${dim("/")}${red(`-${removed}`)}`);
}

// Duration
parts.push(dim(formatDuration(data.cost?.total_duration_ms)));

// Vim mode
if (data.vim?.mode) {
  parts.push(yellow(`[${data.vim.mode}]`));
}

// Context warnings
const usedPct = data.context_window?.used_percentage;
if (usedPct != null && usedPct >= 60) {
  parts.push(bold(yellow(`⚠ ${usedPct}% ctx`)));
}
if (data.exceeds_200k_tokens) {
  parts.push(bold(red("⚠ >200k")));
}

process.stdout.write(parts.join(dim(" │ ")));
