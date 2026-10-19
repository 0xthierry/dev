#!/usr/bin/env bun
/**
 * Regenerate ../references/endpoint-catalog.md from Roblox's official OpenAPI document.
 *
 *   bun .agents/skills/roblox-open-cloud-api/scripts/gen_catalog.ts
 *       downloads the latest spec from github.com/Roblox/creator-docs (no key needed)
 *   bun .agents/skills/roblox-open-cloud-api/scripts/gen_catalog.ts --spec openapi.json --source "creator-docs@<sha>"
 *       uses a local copy
 *
 * The spec is content/en-us/reference/cloud/openapi.json in the creator-docs repository (also
 * offered at https://create.roblox.com/docs/cloud/openapi.json). The catalog lists every
 * operation that accepts an API key (x-api-key), grouped by the spec's feature tags.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const USAGE = `usage: gen_catalog.ts [--spec openapi.json] [--source TEXT] [--out FILE]
  --spec    local openapi.json (default: download the latest)
  --source  text identifying the spec version, written into the catalog header
  --out     where to write the catalog (default: references/endpoint-catalog.md)`;

const SPEC_PATH = "content/en-us/reference/cloud/openapi.json";
const SPEC_URL = `https://raw.githubusercontent.com/Roblox/creator-docs/main/${SPEC_PATH}`;
const COMMITS_URL = `https://api.github.com/repos/Roblox/creator-docs/commits?path=${SPEC_PATH}&per_page=1`;
const OUT = join(import.meta.dir, "..", "references", "endpoint-catalog.md");
const METHODS = new Set(["get", "post", "put", "patch", "delete"]);

type Json = Record<string, unknown>;
type Row = { method: string; endpoint: string; stability: string; scopes: string; rate: string; inGame: string; summary: string };
type Counts = { all: number; cookie: number; none: number; other: number };

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const today = (): string => new Date().toISOString().slice(0, 10);

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "gen_catalog.ts (roblox-open-cloud-api skill)" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} on GET ${url}`);
  return response.text();
}

async function latestSource(): Promise<string> {
  try {
    const commit: unknown = list(JSON.parse(await fetchText(COMMITS_URL)))[0];
    const sha = isRecord(commit) ? text(commit.sha) : "";
    const committer = isRecord(commit) && isRecord(commit.commit) && isRecord(commit.commit.committer) ? commit.commit.committer : {};
    const date = text(committer.date);
    if (sha && date) return `github.com/Roblox/creator-docs@${sha.slice(0, 7)} (${date.slice(0, 10)})`;
  } catch {}
  return `${SPEC_URL} (downloaded ${today()})`; // the GitHub API is rate limited; the date still identifies the run
}

function firstUrl(servers: unknown): string | undefined {
  const first = list(servers)[0];
  return isRecord(first) && typeof first.url === "string" ? first.url : undefined;
}

function rowsByTag(spec: Json): { rows: Map<string, Row[]>; counts: Counts } {
  const defaultHost = firstUrl(spec.servers) ?? "https://apis.roblox.com";
  const rows = new Map<string, Row[]>();
  const counts: Counts = { all: 0, cookie: 0, none: 0, other: 0 };
  for (const [path, item] of Object.entries(isRecord(spec.paths) ? spec.paths : {})) {
    if (!isRecord(item)) continue;
    for (const [method, op] of Object.entries(item)) {
      if (!METHODS.has(method) || !isRecord(op)) continue;
      const auth = new Set(list(op.security).flatMap((requirement) => (isRecord(requirement) ? Object.keys(requirement) : [])));
      counts.all += 1;
      if (!auth.has("roblox-api-key")) {
        if (auth.size === 1 && auth.has("roblox-legacy-cookie")) counts.cookie += 1;
        else if (auth.size === 0) counts.none += 1;
        else counts.other += 1;
        continue;
      }
      const host = firstUrl(op.servers) ?? firstUrl(item.servers) ?? defaultHost;
      const scopes: string[] = [];
      for (const scope of list(op["x-roblox-scopes"])) {
        if (!isRecord(scope)) continue;
        const name = text(scope.name) + (scope.firstPartyOAuthOnly ? " (1P OAuth)" : "");
        if (text(scope.name) && !scopes.includes(name)) scopes.push(name);
      }
      const limits = isRecord(op["x-roblox-rate-limits"]) ? op["x-roblox-rate-limits"] : {};
      const owner = limits.perApiKeyOwner;
      let rate = isRecord(owner) ? `${String(owner.maxInPeriod)}/${text(owner.period).toLowerCase()}` : "";
      if (limits.description) rate = `${rate} +more`.trim();
      const tag = text(list(op.tags)[0]) || "Untagged";
      const summary = (text(op.summary) || text(op.operationId)).split(/\s+/).filter(Boolean).join(" ");
      const usable = isRecord(op["x-roblox-engine-usability"]) ? Object.values(op["x-roblox-engine-usability"]) : [];
      const row: Row = {
        method: method.toUpperCase(),
        endpoint: host.replaceAll("https://", "") + path,
        stability: (text(op["x-roblox-stability"]) || (op.deprecated ? "deprecated" : "")).toLowerCase(),
        scopes: scopes.map((s) => `\`${s}\``).join(", "),
        rate,
        inGame: usable.some(Boolean) ? "yes" : "",
        summary: Array.from(summary).slice(0, 90).join("").replaceAll("|", "/"), // 90 characters, not UTF-16 units
      };
      rows.set(tag, [...(rows.get(tag) ?? []), row]);
    }
  }
  return { rows, counts };
}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const anchor = (tag: string): string => tag.toLowerCase().replaceAll(" ", "-").replaceAll("(", "").replaceAll(")", "");

function render(rows: Map<string, Row[]>, counts: Counts, source: string): string {
  const total = [...rows.values()].reduce((sum, group) => sum + group.length, 0);
  const tags = [...rows.keys()].sort(byCodeUnit);
  const lines = [
    "# Open Cloud operations that accept an API key",
    "",
    `Generated by \`scripts/gen_catalog.ts\` from Roblox's official OpenAPI document (${source}). Do not edit by hand; re-run the script.`,
    "",
    `${total} of ${counts.all} documented operations accept the \`x-api-key\` header. Of the rest, ` +
      `${counts.cookie} accept only the browser session cookie (legacy endpoints: never call them from automation) ` +
      `and ${counts.none} declare no auth scheme.`,
    "",
    "Columns: **Stability** = `x-roblox-stability` (stable > beta > experimental; blank = not stated). " +
      "**Scopes** = permissions the key needs (`x-roblox-scopes`). **Rate** = documented limit per API-key owner, " +
      "shared by all of that owner's keys (`+more` = extra limits described on the endpoint page). " +
      "**In-game** = also callable from a server script through HttpService.",
    "",
    "Paths are relative to the host shown; with `oc.ts request` pass the part after `apis.roblox.com` " +
      "(for example `/cloud/v2/universes/123`).",
    "",
    "`oc.ts` refuses payment, payment-profile and billing endpoints (all of `service-efficiency-api`: payments, " +
      "payment_profiles, billing_activities, bills; `ads-management` billing accounts): the user handles money on " +
      "Creator Hub.",
    "",
    "| Group | Operations |",
    "|---|---|",
    ...tags.map((tag) => `| [${tag}](#${anchor(tag)}) | ${rows.get(tag)?.length ?? 0} |`),
  ];
  for (const tag of tags) {
    lines.push("", `## ${tag}`, "", "| Method | Endpoint | Stability | Scopes | Rate | In-game | Summary |", "|---|---|---|---|---|---|---|");
    const sorted = [...(rows.get(tag) ?? [])].sort((a, b) => byCodeUnit(a.endpoint, b.endpoint) || byCodeUnit(a.method, b.method));
    for (const r of sorted) lines.push(`| ${r.method} | \`${r.endpoint}\` | ${[r.stability, r.scopes, r.rate, r.inGame, r.summary].join(" | ")} |`);
  }
  return `${lines.join("\n")}\n`;
}

let options: { spec?: string; source?: string; out?: string; help?: boolean };
try {
  ({ values: options } = parseArgs({
    args: Bun.argv.slice(2),
    options: { spec: { type: "string" }, source: { type: "string" }, out: { type: "string" }, help: { type: "boolean", short: "h" } },
  }));
} catch (error) {
  console.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
  process.exit(2);
}
if (options.help) {
  console.log(USAGE);
  process.exit(0);
}

const spec: unknown = JSON.parse(options.spec ? readFileSync(options.spec, "utf8") : await fetchText(SPEC_URL));
if (!isRecord(spec)) throw new Error("the spec is not a JSON object");
const source = options.source || (options.spec ? `${options.spec}, read ${today()}` : await latestSource());
const { rows, counts } = rowsByTag(spec);
const out = options.out ?? OUT;
writeFileSync(out, render(rows, counts, source));
console.log(`wrote ${out}: ${[...rows.values()].reduce((sum, group) => sum + group.length, 0)} operations in ${rows.size} groups (${source})`);
