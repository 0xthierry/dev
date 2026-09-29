import { afterEach, beforeEach, describe, expect, it, jest } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseUsage, renderUsage, runUsage } from "./usage";

const CODEX = {
  plan_type: "pro",
  rate_limit: { allowed: true, limit_reached: false, primary_window: { used_percent: 21, limit_window_seconds: 604800, reset_after_seconds: 368222, reset_at: 1791048494 }, secondary_window: null },
  code_review_rate_limit: null,
};
const CLAUDE = {
  five_hour: { utilization: 0, resets_at: null },
  seven_day: { utilization: 10, resets_at: "2026-09-30T21:59:59.732181+00:00" },
  seven_day_opus: null,
  seven_day_sonnet: null,
  extra_usage: { is_enabled: false },
};
let temp: string;
let authDir: string;

beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), "cliproxy-usage-test-"));
  authDir = join(temp, ".local/share/cliproxyapi/auth");
  await mkdir(authDir, { recursive: true });
});
afterEach(async () => {
  jest.useRealTimers();
  await rm(temp, { recursive: true, force: true });
});

async function credential(name: string, contents: unknown): Promise<void> {
  await writeFile(join(authDir, name), JSON.stringify(contents));
}

const codexAuth = { type: "codex", email: "codex@example.test", access_token: "codex-secret", account_id: "account-123" };
const claudeAuth = { type: "claude", email: "claude@example.test", access_token: "claude-secret", disabled: true };

describe("provider payload parsing", () => {
  it("uses the reported Codex primary duration rather than assuming five hours", () => {
    expect(parseUsage("codex", CODEX)).toEqual({ windows: [{ label: "7d", usedPercent: 21, resetAt: "2026-10-03T17:28:14.000Z" }] });
  });

  it("reports review and additional quotas when valid and never fabricates null secondary windows", () => {
    const payload = { ...CODEX,
      rate_limit: { primary_window: { used_percent: 20, limit_window_seconds: 18000 }, secondary_window: null },
      code_review_rate_limit: { primary_window: { used_percent: 90, limit_window_seconds: 86400, reset_at: 1791048494 } },
      additional_rate_limits: [{ limit_name: "spark", rate_limit: { primary_window: { used_percent: 15, limit_window_seconds: 3600 } } }],
    };
    expect(parseUsage("codex", payload)).toEqual({ windows: [
      { label: "5h", usedPercent: 20, resetAt: null },
      { label: "review 1d", usedPercent: 90, resetAt: "2026-10-03T17:28:14.000Z" },
      { label: "spark 1h", usedPercent: 15, resetAt: null },
    ] });
  });

  it("reports Claude zero as zero, variant windows, and disabled extra usage", () => {
    expect(parseUsage("claude", { ...CLAUDE, seven_day_opus: { utilization: 42, resets_at: "2026-09-30T00:00:00Z" } })).toEqual({
      windows: [
        { label: "five hour", usedPercent: 0, resetAt: null },
        { label: "seven day", usedPercent: 10, resetAt: "2026-09-30T21:59:59.732Z" },
        { label: "seven day opus", usedPercent: 42, resetAt: "2026-09-30T00:00:00.000Z" },
      ], extraUsage: "disabled",
    });
  });

  it("rejects out-of-range percentages and unrecognized data instead of showing fabricated quota", () => {
    expect(parseUsage("codex", { rate_limit: { primary_window: { used_percent: 101, limit_window_seconds: 18000 } } })).toBeNull();
    expect(parseUsage("claude", { five_hour: null, seven_day: null })).toBeNull();
  });

  it("sanitizes provider-defined Claude variant window labels", () => {
    expect(parseUsage("claude", { "seven_day_\u001b[31m": { utilization: 12, resets_at: null } })).toEqual({
      windows: [{ label: "seven day ?[31m", usedPercent: 12, resetAt: null }], extraUsage: undefined,
    });
  });
});

describe("read-only auth and network boundary", () => {
  it("loads both account types, includes disabled accounts, sends exact fixed HTTPS request headers, and preserves auth bytes", async () => {
    await credential("codex.json", codexAuth);
    await credential("claude.json", claudeAuth);
    const before = await readFile(join(authDir, "codex.json"), "utf8");
    const requests: { url: string; headers: Headers; redirect: NonNullable<RequestInit["redirect"]> }[] = [];
    const result = await runUsage({ authDir, fetcher: async (url, init) => {
      requests.push({ url, headers: new Headers(init.headers), redirect: init.redirect ?? "follow" });
      return Response.json(url.includes("anthropic") ? CLAUDE : CODEX);
    } });
    expect(result).toEqual({ accounts: [
      { provider: "claude", account: "claude@example.test", disabled: true, status: "ok", windows: [
        { label: "five hour", usedPercent: 0, resetAt: null },
        { label: "seven day", usedPercent: 10, resetAt: "2026-09-30T21:59:59.732Z" },
      ], extraUsage: "disabled" },
      { provider: "codex", account: "codex@example.test", disabled: false, status: "ok", windows: [
        { label: "7d", usedPercent: 21, resetAt: "2026-10-03T17:28:14.000Z" },
      ] },
    ] });
    expect(requests.map(request => ({ url: request.url, authorization: request.headers.get("authorization"), accountId: request.headers.get("ChatGPT-Account-Id"), beta: request.headers.get("anthropic-beta"), redirect: request.redirect }))).toEqual([
      { url: "https://api.anthropic.com/api/oauth/usage", authorization: "Bearer claude-secret", accountId: null, beta: "oauth-2025-04-20", redirect: "manual" },
      { url: "https://chatgpt.com/backend-api/wham/usage", authorization: "Bearer codex-secret", accountId: "account-123", beta: null, redirect: "manual" },
    ]);
    expect(await readFile(join(authDir, "codex.json"), "utf8")).toBe(before);
    expect(await readdir(authDir)).toEqual(["claude.json", "codex.json"]);
  });

  it("reports one failure while printing a successful account and never serializes credentials or upstream errors", async () => {
    await credential("a.json", claudeAuth);
    await credential("b.json", codexAuth);
    const result = await runUsage({ authDir, fetcher: async url => {
      if (url.includes("chatgpt")) throw new Error("codex-secret in provider exception");
      return Response.json(CLAUDE);
    } });
    expect(result.accounts.map(account => account.status)).toEqual(["ok", "error"]);
    expect(renderUsage(result)).toContain("claude / claude@example.test [disabled] — OK");
    expect(renderUsage(result)).toContain("codex / codex@example.test — ERROR: Usage request failed");
    expect(JSON.stringify(result) + renderUsage(result)).not.toContain("secret");
  });

  it("refuses redirects without following their Location or exposing it", async () => {
    await credential("codex.json", codexAuth);
    const result = await runUsage({ authDir, fetcher: async () => new Response(null, { status: 302, headers: { Location: "https://attacker.test/codex-secret" } }) });
    expect(result.accounts).toEqual([{ provider: "codex", account: "codex@example.test", disabled: false, status: "error", error: "Usage endpoint redirected" }]);
    expect(JSON.stringify(result)).not.toContain("attacker.test");
  });

  it.each([
    [401, "Authentication rejected (401); retry after proxy refresh or run cliproxy login"],
    [403, "Usage access denied (403)"],
    [429, "Usage rate limited (429); try again later"],
    [503, "Usage service unavailable (5xx); try again later"],
  ])("reports safe actionable HTTP %i without echoing the response body", async (status, error) => {
    await credential("codex.json", codexAuth);
    const result = await runUsage({ authDir, fetcher: async () => new Response("codex-secret: upstream error", { status }) });
    expect(result.accounts).toEqual([{ provider: "codex", account: "codex@example.test", disabled: false, status: "error", error }]);
    expect(JSON.stringify(result)).not.toContain("codex-secret");
  });

  it("reports invalid JSON as invalid usage response without echoing the body", async () => {
    await credential("claude.json", claudeAuth);
    const result = await runUsage({ authDir, fetcher: async () => new Response("claude-secret: broken", { status: 200 }) });
    expect(result.accounts).toEqual([{ provider: "claude", account: "claude@example.test", disabled: true, status: "error", error: "Invalid usage response" }]);
  });

  it("aborts a hung request after fifteen seconds", async () => {
    jest.useFakeTimers({ now: new Date("2026-09-29T00:00:00Z") });
    await credential("codex.json", codexAuth);
    const ready = Promise.withResolvers<void>();
    const pending = runUsage({ authDir, fetcher: async (_url, init) => {
      ready.resolve();
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("codex-secret")), { once: true });
      });
    } });
    await ready.promise;
    jest.advanceTimersByTime(15_000);
    expect((await pending).accounts).toEqual([{ provider: "codex", account: "codex@example.test", disabled: false, status: "error", error: "Usage request timed out" }]);
  });

  it("keeps concurrent quota requests below four even with five accounts", async () => {
    await credential("1.json", claudeAuth);
    await credential("2.json", claudeAuth);
    await credential("3.json", claudeAuth);
    await credential("4.json", claudeAuth);
    await credential("5.json", claudeAuth);
    let active = 0;
    let peak = 0;
    const result = await runUsage({ authDir, fetcher: async () => {
      active++;
      peak = Math.max(peak, active);
      await Bun.sleep(1);
      active--;
      return Response.json(CLAUDE);
    } });
    expect(result.accounts.map(account => account.status)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
    expect(peak).toBeLessThan(5);
  });

  it("flags missing Codex account ID and missing token without any network call", async () => {
    await credential("codex.json", { ...codexAuth, account_id: null });
    await credential("claude.json", { ...claudeAuth, access_token: "" });
    const result = await runUsage({ authDir, fetcher: async () => { throw new Error("unexpected fetch"); } });
    expect(result.accounts).toEqual([
      { provider: "claude", account: "claude@example.test", disabled: true, status: "error", error: "Missing or invalid access token" },
      { provider: "codex", account: "codex@example.test", disabled: false, status: "error", error: "Missing or invalid account ID" },
    ]);
  });

  it("skips unsupported providers but reports malformed JSON and sanitizes terminal controls", async () => {
    await credential("other.json", { type: "gemini", access_token: "other-secret" });
    await writeFile(join(authDir, "bad\u001b[31m.json"), "{broken");
    const result = await runUsage({ authDir, fetcher: async () => { throw new Error("unexpected fetch"); } });
    expect(result.accounts).toEqual([{ provider: "auth", account: "bad?[31m.json", disabled: false, status: "error", error: "Cannot read credential file" }]);
    expect(renderUsage(result)).not.toContain("\u001b");
  });

  it("does not follow auth-file symlinks", async () => {
    await credential("private-target.json", codexAuth);
    await symlink(join(authDir, "private-target.json"), join(authDir, "alias.json"));
    const result = await runUsage({ authDir, fetcher: async () => Response.json(CODEX) });
    expect(result.accounts).toEqual([
      { provider: "auth", account: "alias.json", disabled: false, status: "error", error: "Cannot read credential file" },
      { provider: "codex", account: "codex@example.test", disabled: false, status: "ok", windows: [{ label: "7d", usedPercent: 21, resetAt: "2026-10-03T17:28:14.000Z" }] },
    ]);
  });

  it("returns actionable error for an empty pool and for unreadable auth directory", async () => {
    expect(await runUsage({ authDir })).toEqual({ accounts: [], error: "No Codex or Claude accounts found; run cliproxy login or cliproxy login-claude" });
    await rm(authDir, { recursive: true });
    expect(await runUsage({ authDir })).toEqual({ accounts: [], error: "Cannot read account directory; log in with cliproxy login or cliproxy login-claude" });
  });
});

describe("CLI", () => {
  it("rejects unexpected arguments with exit 2 from an unrelated working directory", () => {
    const child = Bun.spawnSync({ cmd: [process.execPath, join(import.meta.dir, "usage.ts"), "--endpoint", "https://example.test"], cwd: temp, env: { ...process.env, HOME: temp }, stdout: "pipe", stderr: "pipe" });
    expect(child.exitCode).toBe(2);
    expect(child.stderr.toString()).toBe("Usage: cliproxy usage [--json]\n");
  });

  it("returns nonzero and safe JSON for an empty pool", () => {
    const child = Bun.spawnSync({ cmd: [process.execPath, join(import.meta.dir, "usage.ts"), "--json"], cwd: temp, env: { ...process.env, HOME: temp }, stdout: "pipe", stderr: "pipe" });
    expect(child.exitCode).toBe(1);
    expect(JSON.parse(child.stdout.toString())).toEqual({ accounts: [], error: "No Codex or Claude accounts found; run cliproxy login or cliproxy login-claude" });
  });

  it("runs through a symlinked script without using the working directory", async () => {
    const entry = join(temp, "cliproxy-usage.ts");
    await symlink(join(import.meta.dir, "usage.ts"), entry);
    const child = Bun.spawnSync({ cmd: [process.execPath, entry, "--json"], cwd: tmpdir(), env: { ...process.env, HOME: temp }, stdout: "pipe", stderr: "pipe" });
    expect(child.exitCode).toBe(1);
    expect(JSON.parse(child.stdout.toString())).toEqual({ accounts: [], error: "No Codex or Claude accounts found; run cliproxy login or cliproxy login-claude" });
  });

  it("exits nonzero on malformed auth JSON without printing the file contents", async () => {
    await writeFile(join(authDir, "broken.json"), "{codex-secret");
    const child = Bun.spawnSync({ cmd: [process.execPath, join(import.meta.dir, "usage.ts"), "--json"], cwd: temp, env: { ...process.env, HOME: temp }, stdout: "pipe", stderr: "pipe" });
    expect(child.exitCode).toBe(1);
    expect(JSON.parse(child.stdout.toString())).toEqual({ accounts: [{ provider: "auth", account: "broken.json", disabled: false, status: "error", error: "Cannot read credential file" }] });
    expect(child.stdout.toString()).not.toContain("codex-secret");
  });
});
