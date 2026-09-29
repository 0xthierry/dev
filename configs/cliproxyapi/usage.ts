#!/usr/bin/env bun
// Read-only subscription quota inspection. Never send OAuth credentials to the local proxy.
import { lstat, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const ENDPOINTS = {
  codex: "https://chatgpt.com/backend-api/wham/usage",
  claude: "https://api.anthropic.com/api/oauth/usage",
} as const;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_AUTH_BYTES = 1024 * 1024;
const MAX_LABEL_LENGTH = 100;

type Provider = keyof typeof ENDPOINTS;
type Credential =
  | { provider: "codex"; account: string; disabled: boolean; accessToken: string; accountId: string }
  | { provider: "claude"; account: string; disabled: boolean; accessToken: string };
export type UsageWindow = { label: string; usedPercent: number; resetAt: string | null };
export type AccountUsage =
  | { provider: Provider; account: string; disabled: boolean; status: "ok"; windows: UsageWindow[]; extraUsage?: "enabled" | "disabled" }
  | { provider: Provider | "auth"; account: string; disabled: boolean; status: "error"; error: string };
export type UsageResult = { accounts: AccountUsage[]; error?: string };

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;
type Options = { authDir: string; fetcher?: Fetcher };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

// Auth metadata and filenames are untrusted terminal input, not display-ready strings.
function safeLabel(input: string): string {
  const cleaned = input.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "?").slice(0, MAX_LABEL_LENGTH);
  return cleaned || "(unnamed)";
}

function validHeader(value: unknown): value is string {
  return typeof value === "string" && /^[\x21-\x7e]+$/.test(value);
}

function identity(data: Record<string, unknown>, filename: string): string {
  return safeLabel(typeof data.email === "string" && data.email ? data.email : filename);
}

function parseCredential(value: unknown, filename: string): Credential | AccountUsage | null {
  const data = object(value);
  if (!data) return { provider: "auth", account: safeLabel(filename), disabled: false, status: "error", error: "Invalid credential file" };
  if (data.type !== "codex" && data.type !== "claude") return null;
  const provider = data.type;
  const account = identity(data, filename);
  const disabled = data.disabled === true;
  if (!validHeader(data.access_token) || (provider === "codex" && !validHeader(data.account_id))) {
    return { provider, account, disabled, status: "error", error: provider === "codex" && !validHeader(data.account_id) ? "Missing or invalid account ID" : "Missing or invalid access token" };
  }
  if (provider === "codex") {
    // Narrow each untrusted field at the edge, not with an unchecked assertion.
    if (!validHeader(data.account_id)) return { provider, account, disabled, status: "error", error: "Missing or invalid account ID" };
    return { provider, account, disabled, accessToken: data.access_token, accountId: data.account_id };
  }
  return { provider, account, disabled, accessToken: data.access_token };
}

function percentage(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

function resetDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const time = typeof value === "number" && Number.isFinite(value) ? value * 1000 : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(time) && Math.abs(time) <= 8.64e15 ? new Date(time).toISOString() : null;
}

function windowFrom(value: unknown, label: string, kind: "codex" | "claude", nowMs: number): UsageWindow | null {
  const data = object(value);
  if (!data) return null;
  const usedPercent = percentage(kind === "codex" ? data.used_percent : data.utilization);
  if (usedPercent === null) return null;
  let resetAt = resetDate(kind === "codex" ? data.reset_at : data.resets_at);
  if (kind === "codex" && resetAt === null && typeof data.reset_after_seconds === "number" && Number.isFinite(data.reset_after_seconds) && data.reset_after_seconds >= 0) {
    resetAt = resetDate((nowMs / 1000) + data.reset_after_seconds);
  }
  return { label, usedPercent, resetAt };
}

function codexDuration(value: unknown, fallback: string): string {
  const seconds = object(value)?.limit_window_seconds;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) return fallback;
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

function codexWindows(group: unknown, prefix: string, nowMs: number): UsageWindow[] {
  const data = object(group);
  if (!data) return [];
  const windows: UsageWindow[] = [];
  for (const slot of ["primary_window", "secondary_window"] as const) {
    const item = data[slot];
    const window = windowFrom(item, `${prefix}${codexDuration(item, slot === "primary_window" ? "primary" : "secondary")}`, "codex", nowMs);
    if (window) windows.push(window);
  }
  return windows;
}

/** Parse only known usage fields; never copy raw provider payload into the result. */
export function parseUsage(provider: Provider, payload: unknown, nowMs = Date.now()): Pick<Extract<AccountUsage, { status: "ok" }>, "windows" | "extraUsage"> | null {
  const data = object(payload);
  if (!data) return null;
  if (provider === "codex") {
    const windows = [
      ...codexWindows(data.rate_limit, "", nowMs),
      ...codexWindows(data.code_review_rate_limit, "review ", nowMs),
    ];
    const additional = data.additional_rate_limits;
    if (Array.isArray(additional)) {
      for (const item of additional) {
        const entry = object(item);
        if (!entry) continue;
        const name = typeof entry.limit_name === "string" ? safeLabel(entry.limit_name) : "additional";
        windows.push(...codexWindows(entry.rate_limit, `${name} `, nowMs));
      }
    } else {
      const groups = object(additional);
      if (groups) for (const [name, group] of Object.entries(groups)) windows.push(...codexWindows(object(group)?.rate_limit ?? group, `${safeLabel(name)} `, nowMs));
    }
    return windows.length ? { windows } : null;
  }
  const windows: UsageWindow[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key !== "five_hour" && key !== "seven_day" && !key.startsWith("seven_day_")) continue;
    const window = windowFrom(value, safeLabel(key.replaceAll("_", " ")), "claude", nowMs);
    if (window) windows.push(window);
  }
  const extra = object(data.extra_usage);
  const extraUsage = typeof extra?.is_enabled === "boolean" ? extra.is_enabled ? "enabled" : "disabled" : undefined;
  return windows.length || extraUsage !== undefined ? { windows, extraUsage } : null;
}

function httpError(status: number, provider: Provider): string {
  if (status === 401) return `Authentication rejected (401); retry after proxy refresh or run cliproxy ${provider === "codex" ? "login" : "login-claude"}`;
  if (status === 403) return "Usage access denied (403)";
  if (status === 429) return "Usage rate limited (429); try again later";
  if (status >= 500 && status <= 599) return "Usage service unavailable (5xx); try again later";
  return `Usage request rejected (${status})`;
}

async function fetchUsage(credential: Credential, fetcher: Fetcher): Promise<AccountUsage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let failure: string | null = null;
  try {
    const headers: Record<string, string> = { Authorization: `Bearer ${credential.accessToken}` };
    if (credential.provider === "codex") headers["ChatGPT-Account-Id"] = credential.accountId;
    else headers["anthropic-beta"] = "oauth-2025-04-20";
    const response = await fetcher(ENDPOINTS[credential.provider], { headers, redirect: "manual", signal: controller.signal });
    if (response.status >= 300 && response.status < 400) {
      failure = "redirect";
      throw new Error();
    }
    if (!response.ok) {
      failure = httpError(response.status, credential.provider);
      throw new Error();
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      failure = "payload";
      throw new Error();
    }
    const parsed = parseUsage(credential.provider, payload);
    if (!parsed) {
      failure = "payload";
      throw new Error();
    }
    return { provider: credential.provider, account: credential.account, disabled: credential.disabled, status: "ok", ...parsed };
  } catch {
    // Never print caught errors: runtime/provider errors may include headers or token text.
    const reason = controller.signal.aborted ? "Usage request timed out" : failure === "redirect" ? "Usage endpoint redirected" : failure === "payload" ? "Invalid usage response" : failure ?? "Usage request failed";
    return { provider: credential.provider, account: credential.account, disabled: credential.disabled, status: "error", error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/** Read the deployment's credential directory without modifying it; process network calls sequentially. */
export async function runUsage({ authDir, fetcher = fetch }: Options): Promise<UsageResult> {
  let files: string[];
  try {
    if ((await lstat(authDir)).isSymbolicLink()) throw new Error("symlink");
    files = (await readdir(authDir)).filter(name => name.endsWith(".json")).sort();
  } catch {
    return { accounts: [], error: "Cannot read account directory; log in with cliproxy login or cliproxy login-claude" };
  }
  const accounts: AccountUsage[] = [];
  for (const filename of files) {
    const path = join(authDir, filename);
    let parsed: Credential | AccountUsage | null;
    try {
      const stat = await lstat(path);
      if (!stat.isFile() || stat.size > MAX_AUTH_BYTES) throw new Error("invalid auth file");
      const contents = await readFile(path, "utf8");
      parsed = parseCredential(JSON.parse(contents), filename);
    } catch {
      accounts.push({ provider: "auth", account: safeLabel(filename), disabled: false, status: "error", error: "Cannot read credential file" });
      continue;
    }
    if (!parsed) continue; // Other providers are outside this command's scope.
    if ("status" in parsed) accounts.push(parsed);
    else accounts.push(await fetchUsage(parsed, fetcher));
  }
  return { accounts, ...(!accounts.length ? { error: "No Codex or Claude accounts found; run cliproxy login or cliproxy login-claude" } : {}) };
}

export function renderUsage(result: UsageResult): string {
  const lines: string[] = [];
  for (const account of result.accounts) {
    lines.push(`${account.provider} / ${account.account}${account.disabled ? " [disabled]" : ""} — ${account.status === "ok" ? "OK" : `ERROR: ${account.error}`}`);
    if (account.status !== "ok") continue;
    if (!account.windows.length) lines.push("  No quota windows reported");
    for (const window of account.windows) {
      lines.push(`  ${window.label}: ${window.usedPercent}% used${window.resetAt ? `; resets ${window.resetAt}` : "; reset unreported"}`);
    }
    if (account.extraUsage) lines.push(`  extra usage: ${account.extraUsage}`);
  }
  if (result.error) lines.push(`ERROR: ${result.error}`);
  return lines.join("\n") + "\n";
}

export async function main(args: string[], home = process.env.HOME): Promise<number> {
  if (args.some(arg => arg !== "--json") || args.length > 1) {
    console.error("Usage: cliproxy usage [--json]");
    return 2;
  }
  const result = home ? await runUsage({ authDir: join(home, ".local/share/cliproxyapi/auth") }) : { accounts: [], error: "HOME is unavailable; cannot find account directory" };
  process.stdout.write(args[0] === "--json" ? `${JSON.stringify(result)}\n` : renderUsage(result));
  return result.error || result.accounts.some(account => account.status === "error") ? 1 : 0;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
