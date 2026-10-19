#!/usr/bin/env bun
/**
 * Roblox Open Cloud client for agents. Bun, no dependencies.
 *
 * Usage, from the project's folder:  bun ~/.agents/skills/roblox-open-cloud-api/scripts/oc.ts <command> ...
 *
 * The API key comes only from OPEN_CLOUD_API_KEY in the environment; the user exports it in their
 * shell profile. The key never appears in output, URLs or files this script writes. It is sent only as the
 * x-api-key header (introspect: in the request body), only over https, and only to
 * apis.roblox.com or thumbnails.roblox.com. Redirects are never followed while it is attached.
 * Payment and billing endpoints are refused outright.
 *
 * Writes are dry runs: without --yes, any command that changes something prints the planned
 * request and exits 3. Show the plan to the user and re-run with --yes only after they agree.
 */
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

const HELP = `oc.ts: Roblox Open Cloud client (roblox-open-cloud-api skill)

Commands (results as JSON on stdout, diagnostics on stderr; add --help to any command):
  introspect                          what the key can do: scopes, experiences, expiry
  request METHOD PATH                 any endpoint; --json/--json-file, --query K=V, --form K=V,
                                      --form-file K=PATH; writes (and memory-store queue reads)
                                      need --yes
  upload --file F --name N            create an asset (Image, Model, Audio, ...), wait for it,
                                      record it in the upload lock
  update-asset --asset-id ID          new .fbx content (new version, same ID) and/or name/description
  operation PATH|ID                   poll an asset operation, a v2 operation or a Luau task path
  publish --file F.rbxl|F.rbxlx       save or publish a place version
  luau --script-file F                run Luau on a place version (Luau Execution); prints
                                      state, return values and logs
  download --asset-id ID --out FILE   fetch an asset's stored content (Asset Delivery)
  universe-id --place P               universe ID of a place (public endpoint, no key sent)

Defaults read from the environment (flags override them): ROBLOX_CREATOR (user:<id> or
group:<id>), ROBLOX_UNIVERSE_ID, ROBLOX_PLACE_ID.

Upload lock: upload and update-asset record every file by SHA-256 in roblox-uploads.lock.json
at the root of the git repository the command runs in (outside a repository: --lock PATH or
ROBLOX_UPLOAD_LOCK). The entry is written before the request is sent, so a crash or a dropped
connection can't lead to a silent second upload. A file already recorded (done, pending, or
with an unknown outcome) is refused unless --force. Inside a repository the lock can't be
switched off or replaced by another file.

Exit codes: 0 ok, 1 API or network error, 2 usage error, 3 dry run (needs --yes),
4 refused by the upload lock, 5 still running when the wait timed out.`;

const BASE_URL = (process.env.ROBLOX_OPEN_CLOUD_BASE_URL ?? "https://apis.roblox.com").replace(/\/+$/, "");
const KEY_HOSTS = new Set(["apis.roblox.com", "thumbnails.roblox.com"]);
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const LOCK_NAME = "roblox-uploads.lock.json"; // at the root of the git repository
const KEY_FORMAT = /^[\x21-\x7e]+$/; // printable ASCII, no spaces or line breaks
const MAX_UPLOAD = 20 * 1024 * 1024; // Assets API: one file up to 20 MB (official)
const MAX_SCRIPT = 4 * 1024 * 1024; // Luau Execution: script up to 4 MB (official)
const MAX_RETRY_AFTER = 120; // seconds; a longer Retry-After fails instead of blocking the agent
const TERMINAL = new Set(["COMPLETE", "FAILED", "CANCELLED"]); // Luau Execution task states that end polling

const ASSET_TYPES = ["Image", "Decal", "Model", "Animation", "Audio", "Video", "Mesh"] as const;
type AssetType = (typeof ASSET_TYPES)[number];
type FileType = Exclude<AssetType, "Mesh">;
const isAssetType = (value: string): value is AssetType => ASSET_TYPES.some((type) => type === value);

// extension -> content type and default asset type; null means --type is required
const FORMATS: Record<string, { contentType: string; defaultType: FileType | null }> = {
  ".png": { contentType: "image/png", defaultType: "Image" },
  ".jpg": { contentType: "image/jpeg", defaultType: "Image" },
  ".jpeg": { contentType: "image/jpeg", defaultType: "Image" },
  ".bmp": { contentType: "image/bmp", defaultType: "Image" },
  ".tga": { contentType: "image/tga", defaultType: "Image" },
  ".fbx": { contentType: "model/fbx", defaultType: "Model" },
  ".gltf": { contentType: "model/gltf+json", defaultType: "Model" },
  ".glb": { contentType: "model/gltf-binary", defaultType: "Model" },
  ".rbxm": { contentType: "model/x-rbxm", defaultType: null },
  ".rbxmx": { contentType: "model/x-rbxm", defaultType: null },
  ".mp3": { contentType: "audio/mpeg", defaultType: "Audio" },
  ".ogg": { contentType: "audio/ogg", defaultType: "Audio" },
  ".wav": { contentType: "audio/wav", defaultType: "Audio" },
  ".flac": { contentType: "audio/flac", defaultType: "Audio" },
  ".mp4": { contentType: "video/mp4", defaultType: "Video" },
  ".mov": { contentType: "video/mov", defaultType: "Video" },
};
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".bmp", ".tga"]);
const TYPE_EXTS: Record<FileType, ReadonlySet<string>> = {
  Image: IMAGE_EXTS,
  Decal: IMAGE_EXTS,
  Model: new Set([".fbx", ".gltf", ".glb", ".rbxm", ".rbxmx"]),
  Animation: new Set([".rbxm", ".rbxmx"]),
  Audio: new Set([".mp3", ".ogg", ".wav", ".flac"]),
  Video: new Set([".mp4", ".mov"]),
};
// Classes that Open Cloud place publishing does not update (official usage guide)
const PUBLISH_SKIPPED =
  /class="(SurfaceAppearance|PartOperation|UnionOperation|NegateOperation|IntersectOperation|EditableImage|EditableMesh|WrapLayer|WrapTarget|WrapDeformer)"/g;
const PUBLISH_CAVEAT =
  "Open Cloud publishing does not update EditableImage, EditableMesh, PartOperation (unions), " +
  "SurfaceAppearance or BaseWrap instances; publish from Studio after changing those.";
// Luau calls that change saved or live state; listed in the dry-run plan of `luau`
const LUAU_WRITES =
  /\b(SavePlaceAsync|CreatePlaceAsync|SetAsync|UpdateAsync|RemoveAsync|IncrementAsync|AddAsync|PublishAsync|RequestAsync|PostAsync|BanAsync|UnbanAsync|SetRankAsync)\b/g;
// Policy patterns, matched against policyPath(): GET requests with side effects (reading a
// queue hides its items from live servers), and money (the extended-services billing API and
// ad billing accounts), which an agent never touches
const SIDE_EFFECT_GET = /\/memory-store\/queues\/[^/]+\/items:read/;
const FORBIDDEN = /^\/service-efficiency-api(\/|$)|^\/ads-management\/v1\/billing-accounts/;
// fetch error codes raised before anything was sent (no connection, DNS, TLS): retrying can't duplicate
const NOT_SENT = /^(ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH)$|CERT|TLS|SSL/;

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const asText = (value: unknown): string => (typeof value === "string" || typeof value === "number" ? String(value) : "");

class Fail extends Error {
  readonly code: number;
  readonly detail: unknown;
  readonly status: number | undefined; // HTTP status when the failure is an HTTP error response
  readonly sent: false | undefined; // false: the request never reached Roblox; undefined: it may have
  constructor(code: number, message: string, extra: { detail?: unknown; status?: number; sent?: false } = {}) {
    super(message);
    this.code = code;
    this.detail = extra.detail;
    this.status = extra.status;
    this.sent = extra.sent;
  }
}

let secret: string | undefined;

function redact(text: string): string {
  if (!secret) return text;
  for (const form of new Set([secret, JSON.stringify(secret).slice(1, -1)])) text = text.replaceAll(form, "***"); // raw and escaped spellings
  return text;
}

function out(value: unknown): void {
  console.log(redact(JSON.stringify(value, null, 2)));
}

function note(message: string): void {
  console.error(redact(`[oc] ${message}`));
}

function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function errorCode(error: unknown): string {
  return isRecord(error) && typeof error.code === "string" ? error.code : "";
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const code = errorCode(error);
  return code && !error.message.includes(code) ? `${code}: ${error.message}` : `${error.name}: ${error.message}`;
}

const sha256 = (data: Uint8Array | string): string => createHash("sha256").update(data).digest("hex");

// ---------- configuration and the key ----------

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Absolute path with symlinks resolved as far as it exists, so two spellings of one file compare equal. */
function physical(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = dirname(absolute);
    return parent === absolute ? absolute : join(physical(parent), basename(absolute));
  }
}

function ancestors(): string[] {
  const dirs: string[] = [];
  for (let dir = physical(process.cwd()); ; dir = dirname(dir)) {
    dirs.push(dir);
    if (dirname(dir) === dir) return dirs;
  }
}

function setting(name: string, given?: string): string {
  return given ? given : process.env[name]?.trim() || "";
}

function apiKey(): string {
  const key = process.env.OPEN_CLOUD_API_KEY?.trim() ?? "";
  if (!key) {
    throw new Fail(
      2,
      "no API key: OPEN_CLOUD_API_KEY is not set in this shell. The user exports it in their shell profile " +
        "(keys are created at https://create.roblox.com/dashboard/credentials); never ask for it in chat",
    );
  }
  secret = key;
  if (!KEY_FORMAT.test(key)) {
    throw new Fail(2, "OPEN_CLOUD_API_KEY contains spaces, line breaks or non-ASCII characters; the user should set it again (oc.ts does not print it)");
  }
  return key;
}

/** The nearest folder with .git (a directory, or a file in a worktree): the project the lock belongs to. */
function repoRoot(): string | undefined {
  return ancestors().find((dir) => existsSync(join(dir, ".git")));
}

function creator(value: string | undefined): { creator: Record<string, string>; text: string } {
  const text = setting("ROBLOX_CREATOR", value);
  const at = text.indexOf(":");
  const kind = at === -1 ? text : text.slice(0, at);
  const ident = at === -1 ? "" : text.slice(at + 1);
  if ((kind !== "user" && kind !== "group") || !/^\d+$/.test(ident)) {
    throw new Fail(2, "creator must be user:<userId> or group:<groupId> (--creator or ROBLOX_CREATOR)");
  }
  return { creator: { [kind === "user" ? "userId" : "groupId"]: ident }, text };
}

function required(name: string, given: string | undefined, flag: string): string {
  const value = setting(name, given);
  if (!/^\d+$/.test(value)) throw new Fail(2, `${flag} is required (or set ${name})`);
  return value;
}

// ---------- HTTP ----------

function origin(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}:${u.port || (u.protocol === "https:" ? "443" : "80")}`;
}

// A local base URL (ROBLOX_OPEN_CLOUD_BASE_URL=http://127.0.0.1:<port>) is test mode: only that
// exact origin is allowed besides Roblox. Without it, every request must be https.
const TEST_ORIGIN = URL.canParse(BASE_URL) && LOCAL_HOSTS.has(new URL(BASE_URL).hostname) ? origin(BASE_URL) : undefined;

function checkUrl(url: string, keyed: boolean): void {
  if (!URL.canParse(url)) throw new Fail(2, `invalid URL: ${url}`, { sent: false });
  if (TEST_ORIGIN && origin(url) === TEST_ORIGIN) return;
  const { protocol, hostname } = new URL(url);
  if (protocol !== "https:") throw new Fail(2, `refusing a non-https URL: ${url}`, { sent: false });
  if (keyed && !KEY_HOSTS.has(hostname)) {
    throw new Fail(2, `refusing to send the API key to ${hostname} (allowed: ${[...KEY_HOSTS].sort().join(", ")})`, { sent: false });
  }
}

/** The URL path as a server might route it: percent-decoded, repeated slashes collapsed, lower case. */
function policyPath(url: string): string {
  const path = URL.canParse(url) ? new URL(url).pathname : url;
  const decoded = path.replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  return decoded.replace(/\/+/g, "/").toLowerCase();
}

function refuseForbidden(url: string): void {
  if (FORBIDDEN.test(policyPath(url))) {
    throw new Fail(
      2,
      "billing, payment and payment-profile endpoints (service-efficiency-api, ad billing accounts) are never called by agents; the user handles money on Creator Hub",
      { sent: false },
    );
  }
}

function parse(raw: Uint8Array): unknown {
  if (raw.length === 0) return null;
  const text = new TextDecoder().decode(raw);
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 4000);
  }
}

function backoff(headers: Headers | undefined, attempt: number): number {
  const header = headers?.get("retry-after")?.trim();
  const wait = header ? Number(header) : Number.NaN;
  if (!Number.isFinite(wait)) return Math.min(2 ** attempt, 60);
  if (wait > MAX_RETRY_AFTER) {
    throw new Fail(1, `rate limited: Roblox asks to wait ${Math.round(wait)}s (more than ${MAX_RETRY_AFTER}s); try again later`, { status: 429 });
  }
  return Math.max(0, wait);
}

type Body = string | Uint8Array<ArrayBuffer> | FormData;
type HttpOptions = { key?: string; body?: Body; headers?: Record<string, string>; keyInBody?: boolean; retries?: number; timeoutMs?: number };
type HttpResult = { status: number; headers: Headers; body: Uint8Array<ArrayBuffer> };

/** Send one request; retry 429 always, and 5xx or network errors on GET only. */
async function http(method: string, url: string, options: HttpOptions = {}): Promise<HttpResult> {
  const { key, body, headers = {}, keyInBody = false, retries = 5, timeoutMs = 300_000 } = options;
  const keyed = Boolean(key) || keyInBody;
  checkUrl(url, keyed);
  if (keyed) refuseForbidden(url); // every command, not only `request`: IDs end up in paths
  const sendHeaders: Record<string, string> = { "User-Agent": "oc.ts (roblox-open-cloud-api skill)", ...headers };
  if (key) sendHeaders["x-api-key"] = key;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let response: Response;
    let raw: Uint8Array<ArrayBuffer>;
    try {
      response = await fetch(url, {
        method,
        body,
        headers: sendHeaders,
        redirect: keyed ? "manual" : "follow", // following would send x-api-key to the new location
        signal: AbortSignal.timeout(timeoutMs),
      });
      raw = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      // refused, unresolvable or TLS-rejected connections never carried the request; anything else
      // (reset, timeout, a body that broke off) may have reached Roblox
      const sent = NOT_SENT.test(errorCode(error)) ? false : undefined;
      if (method !== "GET" || attempt >= retries) {
        throw new Fail(
          1,
          sent === false
            ? `network error on ${method} ${url}: ${describe(error)}`
            : `connection lost on ${method} ${url} after the request was sent (${describe(error)}); Roblox may have acted on it`,
          { sent },
        );
      }
      const wait = backoff(undefined, attempt);
      note(`network error on GET ${url} (${describe(error)}); retry ${attempt + 1}/${retries} in ${wait}s`);
      await Bun.sleep(wait * 1000);
      continue;
    }
    if (response.status >= 300 && response.status < 400) {
      throw new Fail(1, `HTTP ${response.status} redirect from ${method} ${url} not followed${keyed ? " (the API key is attached)" : ""}`, {
        status: response.status,
      });
    }
    if (response.ok) return { status: response.status, headers: response.headers, body: raw };
    if (attempt < retries && (response.status === 429 || (response.status >= 500 && method === "GET"))) {
      const wait = backoff(response.headers, attempt);
      note(`HTTP ${response.status} on ${method} ${url}; retry ${attempt + 1}/${retries} in ${wait}s`);
      await Bun.sleep(wait * 1000);
      continue;
    }
    throw new Fail(1, `HTTP ${response.status} on ${method} ${url}`, { detail: parse(raw), status: response.status });
  }
  throw new Fail(1, `gave up on ${method} ${url}`);
}

function urlFor(path: string, query?: [string, string][]): string {
  let url = /^https?:\/\//.test(path) ? path : `${BASE_URL}/${path.replace(/^\/+/, "")}`;
  if (query && query.length > 0) url += (url.includes("?") ? "&" : "?") + new URLSearchParams(query).toString();
  return url;
}

/** operations/<id> or a bare id -> Assets v1; cloud/v2/... as given (memory-store flush);
 * universes/... or users/... -> /cloud/v2/; /path or a URL as given. */
function operationUrl(ref: string): string {
  const r = ref.trim();
  if (/^(https?:\/\/|\/)/.test(r)) return urlFor(r);
  if (r.startsWith("operations/")) return urlFor(`/assets/v1/${r}`);
  if (r.startsWith("cloud/")) return urlFor(`/${r}`);
  if (!r.includes("/")) return urlFor(`/assets/v1/operations/${r}`);
  return urlFor(`/cloud/v2/${r}`);
}

type FilePart = { field: string; filename: string; contentType: string; data: Uint8Array<ArrayBuffer> };

function multipart(fields: [string, string][], files: FilePart[]): FormData {
  const body = new FormData();
  for (const [name, value] of fields) body.append(name, value);
  for (const file of files) body.append(file.field, new File([file.data], file.filename, { type: file.contentType }));
  return body;
}

async function waitFor(url: string, key: string, timeoutS: number, finished: (r: Json) => boolean): Promise<Json> {
  const deadline = performance.now() + timeoutS * 1000;
  let delay = 1;
  for (;;) {
    const result = parse((await http("GET", url, { key })).body);
    if (!isRecord(result)) throw new Fail(1, `unexpected response from ${url}`, { detail: result });
    if (finished(result) || performance.now() + delay * 1000 > deadline) return result;
    await Bun.sleep(delay * 1000);
    delay = Math.min(delay * 2, 10);
  }
}

function confirm(yes: boolean, plan: Json): void {
  if (yes) return;
  out({ dryRun: true, plan, next: "Nothing was sent. Show this plan to the user; re-run with --yes only after they agree." });
  throw new Fail(3, "dry run: add --yes after the user agrees");
}

function pairs(items: string[], flag: string): [string, string][] {
  return items.map((item) => {
    const at = item.indexOf("=");
    if (at === -1) throw new Fail(2, `${flag} expects KEY=VALUE, got ${JSON.stringify(item)}`);
    return [item.slice(0, at), item.slice(at + 1)];
  });
}

// ---------- upload lock ----------

type LockEntry = Json; // id, sha256, file, state (sending, pending, done, unknown, failed), operation, assetId, ...
type LockFile = Json & { uploads: LockEntry[] };

function blocking(data: LockFile, sha: string): LockEntry | undefined {
  return data.uploads.filter((u) => u.sha256 === sha && u.state !== "failed").at(-1);
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM"; // exists, owned by another user
  }
}

/** roblox-uploads.lock.json. Every change re-reads the file while holding a mutex file next to
 * it, so concurrent runs merge instead of overwriting each other. A mutex whose process is gone
 * is taken over. */
class Lock {
  constructor(readonly path: string) {}

  private async held<T>(work: () => T): Promise<T> {
    const mutex = `${this.path}.mutex.tmp`;
    mkdirSync(dirname(this.path), { recursive: true });
    const deadline = performance.now() + 30_000;
    for (;;) {
      try {
        const fd = openSync(mutex, "wx");
        writeFileSync(fd, String(process.pid));
        closeSync(fd);
        break;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw error;
      }
      let holder: number;
      let age: number;
      try {
        holder = Number(readFileSync(mutex, "utf8"));
        age = Date.now() - statSync(mutex).mtimeMs;
      } catch {
        continue; // released between the two checks
      }
      // a holder writes its PID right after creating the file; an empty file older than 5 s was abandoned
      const stale = Number.isInteger(holder) && holder > 0 ? !processAlive(holder) : age > 5_000;
      if (stale) {
        try {
          unlinkSync(mutex);
        } catch {}
        continue;
      }
      if (performance.now() > deadline) {
        throw new Fail(1, `the upload lock is busy: process ${holder} holds ${mutex}; if no oc.ts run is active, remove that file`);
      }
      await Bun.sleep(25);
    }
    try {
      return work();
    } finally {
      unlinkSync(mutex);
    }
  }

  private read(): LockFile {
    if (!existsSync(this.path)) return { version: 1, uploads: [] };
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(this.path, "utf8"));
    } catch (error) {
      throw new Fail(1, `${this.path} is not valid JSON (${describe(error)}); fix it before uploading`);
    }
    if (!isRecord(data) || !Array.isArray(data.uploads) || !data.uploads.every(isRecord)) {
      throw new Fail(1, `${this.path} is not an upload lock (expected {"uploads": [...]}); fix it before uploading`);
    }
    return { ...data, uploads: data.uploads };
  }

  private write(data: LockFile): void {
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
    renameSync(tmp, this.path);
  }

  find(sha: string): Promise<LockEntry | undefined> {
    return this.held(() => blocking(this.read(), sha));
  }

  /** Record entry (state "sending") unless its file is already recorded; returns the prior entry. */
  claim(entry: LockEntry & { sha256: string }, force: boolean): Promise<LockEntry | undefined> {
    return this.held(() => {
      const data = this.read();
      const prior = force ? undefined : blocking(data, entry.sha256);
      if (prior) return prior;
      data.uploads.push(entry);
      this.write(data);
      return undefined;
    });
  }

  /** Update entries whose fields include all of match; returns how many matched. */
  update(match: LockEntry, fields: LockEntry): Promise<number> {
    return this.held(() => {
      const data = this.read();
      const hits = data.uploads.filter((u) => Object.entries(match).every(([k, v]) => u[k] === v));
      for (const hit of hits) Object.assign(hit, fields);
      if (hits.length > 0) this.write(data);
      return hits.length;
    });
  }
}

type LockFlags = { lock: string | undefined; noLock: boolean };

function openLock(flags: LockFlags, requiredLock = true): Lock | undefined {
  const explicit = flags.lock || process.env.ROBLOX_UPLOAD_LOCK;
  const root = repoRoot();
  const projectLock = root ? join(root, LOCK_NAME) : undefined;
  if (flags.noLock) {
    if (requiredLock && (explicit || root)) {
      throw new Fail(2, "inside a git repository the upload lock is mandatory (upload once); use --force only if the user wants a second upload of the same file");
    }
    return undefined;
  }
  if (projectLock) {
    if (explicit && physical(explicit) !== physical(projectLock)) {
      throw new Fail(2, `inside this repository the upload lock is ${projectLock}; another lock file would bypass upload-once`);
    }
    return new Lock(projectLock);
  }
  if (explicit) return new Lock(explicit);
  if (requiredLock) {
    throw new Fail(2, `no upload lock: run inside a git repository (the lock is ${LOCK_NAME} at its root) or pass --lock PATH; --no-lock only outside a repository`);
  }
  return undefined;
}

function relPath(path: string): string {
  const root = repoRoot();
  const absolute = physical(path);
  if (!root) return absolute;
  const rel = relative(root, absolute);
  return rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel) ? absolute : rel;
}

function refusal(lock: Lock, prior: LockEntry, name: string): Fail {
  let hint: string;
  switch (prior.state) {
    case "done":
      hint = `reuse asset ${asText(prior.assetId)}`;
      break;
    case "pending":
      hint = `it is still processing: resume with \`oc.ts operation ${asText(prior.operation)}\``;
      break;
    case "unknown":
      hint = `the earlier attempt's outcome is unknown (${asText(prior.error) || "network error"}): check the creator's Development Items on Creator Hub for it before any retry`;
      break;
    default: // sending
      hint = "another oc.ts run is sending it now, or one stopped mid-request: check Creator Hub before any retry";
  }
  out({ refused: "already in the upload lock", existing: prior });
  return new Fail(4, `${name} is already in ${lock.path}: ${hint}. Pass --force only if the user wants a second upload of the same file.`);
}

/** The asset operation path in a response, or undefined when the response is the result itself. */
function operationPath(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined;
  const path = asText(result.path);
  if (path.startsWith("operations/") || path.includes("/operations/")) return path;
  return result.operationId ? `operations/${asText(result.operationId)}` : undefined;
}

type AssetOutcome =
  | { state: "done"; assetId: string; revisionId: string; moderationState: string | null; finishedAt: string }
  | { state: "failed"; error: unknown; finishedAt: string };

/** Lock fields for a finished Assets operation, or undefined while it runs. */
function assetOutcome(result: Json): AssetOutcome | undefined {
  if (result.done !== true) return undefined;
  if (result.error) return { state: "failed", error: result.error, finishedAt: utcNow() };
  const asset = isRecord(result.response) ? result.response : {};
  const moderation = isRecord(asset.moderationResult) ? asset.moderationResult.moderationState : undefined;
  return {
    state: "done",
    assetId: asText(asset.assetId),
    revisionId: asText(asset.revisionId),
    moderationState: typeof moderation === "string" ? moderation : null,
    finishedAt: utcNow(),
  };
}

type WaitFlags = { force: boolean; noWait: boolean; timeout: number };
type AssetRequest = { key: string; method: "POST" | "PATCH"; url: string; body: FormData; lock: Lock | undefined; entry: LockEntry & { id: string } };

/** POST/PATCH an Assets request, keep the lock entry in step, wait for the operation. */
async function sendAsset(flags: WaitFlags, request: AssetRequest): Promise<void> {
  const { key, method, url, body, lock, entry } = request;
  if (lock && typeof entry.sha256 === "string") {
    const prior = await lock.claim({ ...entry, sha256: entry.sha256 }, flags.force);
    if (prior) throw refusal(lock, prior, asText(entry.file) || "this file");
  }
  let result: unknown;
  try {
    result = parse((await http(method, url, { key, body })).body);
  } catch (error) {
    if (lock && error instanceof Fail) {
      // nothing was created when Roblox rejected it (4xx) or never got it; otherwise it may exist
      const nothing = (error.status !== undefined && error.status >= 400 && error.status < 500) || error.sent === false;
      await lock.update({ id: entry.id }, { state: nothing ? "failed" : "unknown", error: error.message, finishedAt: utcNow() });
    }
    throw error;
  }
  const opPath = operationPath(result);
  if (!opPath) {
    if (method === "PATCH" && !lock && isRecord(result)) {
      out({ result: { ...entry, state: "done" }, response: result }); // metadata updates may return the fields
      return;
    }
    if (lock) await lock.update({ id: entry.id }, { state: "unknown", error: "no operation in the response" });
    throw new Fail(1, "the Assets API returned no operation", { detail: result });
  }
  if (lock) await lock.update({ id: entry.id }, { operation: opPath, state: "pending" });
  let operation: Json = isRecord(result) ? result : {};
  if (operation.done !== true && !flags.noWait) {
    operation = await waitFor(operationUrl(opPath), key, flags.timeout, (r) => r.done === true);
  }
  const outcome = assetOutcome(operation);
  if (outcome && lock) await lock.update({ id: entry.id }, outcome);
  const summary: Json = { ...entry, operation: opPath, ...(outcome ?? { state: "pending" }) };
  if (asText(summary.assetId)) summary.rbxassetid = `rbxassetid://${asText(summary.assetId)}`;
  out({ result: summary, operation });
  if (outcome === undefined) {
    if (flags.noWait) return;
    throw new Fail(5, `operation ${opPath} still running after ${flags.timeout}s; resume with \`oc.ts operation ${opPath}\``);
  }
  if (outcome.state === "failed") throw new Fail(1, `operation ${opPath} failed`, { detail: outcome.error });
}

// ---------- commands ----------

type Values = Record<string, string | boolean | (string | boolean)[] | undefined>;

function text(values: Values, name: string): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

function list(values: Values, name: string): string[] {
  const value = values[name];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

const flag = (values: Values, name: string): boolean => values[name] === true;

function need(values: Values, name: string): string {
  const value = text(values, name);
  if (!value) throw new Fail(2, `--${name} is required`);
  return value;
}

function seconds(values: Values, name: string, fallback: number): number {
  const raw = text(values, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value) || value < 0) throw new Fail(2, `--${name} must be a number of seconds`);
  return value;
}

const lockFlags = (values: Values): LockFlags => ({ lock: text(values, "lock"), noLock: flag(values, "no-lock") });
const waitFlags = (values: Values, defaultTimeout: number): WaitFlags => ({
  force: flag(values, "force"),
  noWait: flag(values, "no-wait"),
  timeout: seconds(values, "timeout", defaultTimeout),
});

async function cmdIntrospect(): Promise<void> {
  const key = apiKey();
  const { body } = await http("POST", urlFor("/api-keys/v1/introspect"), {
    body: JSON.stringify({ apiKey: key }),
    keyInBody: true,
    headers: { "Content-Type": "application/json" },
  });
  out(parse(body));
}

async function cmdRequest(values: Values, [rawMethod = "", path = ""]: string[]): Promise<void> {
  const method = rawMethod.toUpperCase();
  if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) throw new Fail(2, `unsupported method ${method}`);
  const url = urlFor(path, pairs(list(values, "query"), "--query"));
  refuseForbidden(url);
  const json = text(values, "json");
  const jsonFile = text(values, "json-file");
  const formFields = pairs(list(values, "form"), "--form");
  const formFiles = pairs(list(values, "form-file"), "--form-file");
  if (json !== undefined && jsonFile !== undefined) throw new Fail(2, "use --json or --json-file, not both");
  let body: Body | undefined;
  let shown: unknown = null;
  const headers: Record<string, string> = {};
  if (json !== undefined || jsonFile) {
    const raw = json ?? readFileSync(jsonFile ?? "", "utf8");
    try {
      shown = JSON.parse(raw);
    } catch (error) {
      throw new Fail(2, `invalid JSON body: ${describe(error)}`);
    }
    body = JSON.stringify(shown);
    headers["Content-Type"] = "application/json";
  } else if (formFields.length > 0 || formFiles.length > 0) {
    const files = formFiles.map(([field, filePath]) => ({
      field,
      filename: basename(filePath),
      contentType: FORMATS[extname(filePath).toLowerCase()]?.contentType ?? "application/octet-stream",
      data: new Uint8Array(readFileSync(filePath)),
    }));
    body = multipart(formFields, files);
    shown = {
      form: Object.fromEntries(formFields),
      files: Object.fromEntries(formFiles.map(([field, filePath]) => [field, { path: filePath, bytes: statSync(filePath).size }])),
    };
  }
  if (method === "GET" && body !== undefined) throw new Fail(2, "a GET request takes no body (--json, --json-file, --form)");
  if (method !== "GET" || SIDE_EFFECT_GET.test(policyPath(url))) {
    const plan: Json = { method, url, body: shown };
    if (method === "GET") plan.effect = "Reading a memory-store queue hides the items from live servers for the invisibility window.";
    confirm(flag(values, "yes"), plan);
  }
  const key = apiKey();
  const response = await http(method, url, { key, body, headers });
  out(parse(response.body) ?? { status: response.status });
}

async function cmdUpload(values: Values): Promise<void> {
  const file = need(values, "file");
  const name = need(values, "name");
  if (!isFile(file)) throw new Fail(2, `no such file: ${JSON.stringify(file)}`);
  const ext = extname(file).toLowerCase();
  const requested = text(values, "type");
  if (requested !== undefined && !isAssetType(requested)) throw new Fail(2, `--type must be one of ${ASSET_TYPES.join(", ")}`);
  let contentType: string;
  let assetType: AssetType;
  if (requested === "Mesh") {
    contentType = "model/x-file-mesh-data"; // only content downloaded from Asset Delivery (official)
    assetType = "Mesh";
  } else {
    const format = FORMATS[ext];
    if (!format) throw new Fail(2, `unsupported file type ${JSON.stringify(ext)} (see references/02-assets.md)`);
    const chosen = requested ?? format.defaultType;
    if (!chosen) throw new Fail(2, `${ext} needs --type Model or --type Animation`);
    if (!TYPE_EXTS[chosen].has(ext)) throw new Fail(2, `--type ${chosen} does not take ${ext} files`);
    contentType = format.contentType;
    assetType = chosen;
  }
  const data = new Uint8Array(readFileSync(file));
  if (data.length > MAX_UPLOAD && assetType !== "Video") {
    throw new Fail(2, `${basename(file)} is ${data.length} bytes; the Assets API takes at most 20 MB per file`);
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => data[i] === byte);
  if (png && data.length >= 24 && new TextDecoder().decode(data.subarray(12, 16)) === "IHDR") {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const [w, h] = [view.getUint32(16), view.getUint32(20)];
    if (Math.max(w, h) >= 8000) throw new Fail(2, `${basename(file)} is ${w}x${h}; images must be smaller than 8000x8000`);
  }
  if (assetType === "Decal") note("a Decal upload returns a Decal ID; texture properties need an Image ID (use --type Image)");
  if (ext === ".gltf") note(".gltf files reference external .bin/texture files that are not uploaded; export .glb instead");
  const who = creator(text(values, "creator"));
  const sha = sha256(data);
  const lock = openLock(lockFlags(values));
  const prior = lock && !flag(values, "force") ? await lock.find(sha) : undefined;
  if (lock && prior) throw refusal(lock, prior, basename(file));
  const meta = { assetType, displayName: name, description: text(values, "description") ?? "", creationContext: { creator: who.creator } };
  const url = urlFor("/assets/v1/assets");
  const plan: Json = {
    method: "POST",
    url,
    request: meta,
    file: { path: file, bytes: data.length, sha256: sha, contentType },
    lock: lock?.path ?? null,
    effect: "Creates a new, permanent, moderated asset owned by the creator.",
  };
  confirm(flag(values, "yes"), plan);
  const key = apiKey();
  const body = multipart([["request", JSON.stringify(meta)]], [{ field: "fileContent", filename: basename(file), contentType, data }]);
  const entry = {
    id: crypto.randomUUID().replaceAll("-", ""),
    sha256: sha,
    file: relPath(file),
    assetType,
    displayName: name,
    creator: who.text,
    state: "sending",
    uploadedAt: utcNow(),
  };
  await sendAsset(waitFlags(values, 600), { key, method: "POST", url, body, lock, entry });
}

async function cmdUpdateAsset(values: Values): Promise<void> {
  const assetId = need(values, "asset-id");
  const meta: Json = { assetId };
  const mask: string[] = [];
  const name = text(values, "name");
  const description = text(values, "description");
  if (name) {
    meta.displayName = name;
    mask.push("displayName");
  }
  if (description !== undefined) {
    meta.description = description;
    mask.push("description");
  }
  const file = text(values, "file");
  const plan: Json = {};
  const files: FilePart[] = [];
  let lock: Lock | undefined;
  let sha: string | null = null;
  if (file) {
    if (extname(file).toLowerCase() !== ".fbx" || !isFile(file)) {
      throw new Fail(2, "--file must be an existing .fbx: only FBX model content can be updated (official)");
    }
    const data = new Uint8Array(readFileSync(file));
    if (data.length > MAX_UPLOAD) throw new Fail(2, `${basename(file)} is ${data.length} bytes; the Assets API takes at most 20 MB per file`);
    sha = sha256(data);
    meta.creationContext = { creator: creator(text(values, "creator")).creator };
    files.push({ field: "fileContent", filename: basename(file), contentType: "model/fbx", data });
    lock = openLock(lockFlags(values));
    const prior = lock && !flag(values, "force") ? await lock.find(sha) : undefined;
    if (lock && prior) throw refusal(lock, prior, basename(file));
    plan.file = { path: file, bytes: data.length, sha256: sha, contentType: "model/fbx" };
    plan.effect = "Adds a new version to the existing Model asset (same asset ID).";
  }
  if (files.length === 0 && mask.length === 0) throw new Fail(2, "nothing to update: give --file and/or --name/--description");
  const assetType = text(values, "type") || (files.length > 0 ? "Model" : "");
  if (!assetType) throw new Fail(2, "--type is required for metadata-only updates (the asset's type, e.g. Image or Model)");
  meta.assetType = assetType;
  const url = urlFor(`/assets/v1/assets/${assetId}`, mask.length > 0 ? [["updateMask", mask.join(",")]] : undefined);
  Object.assign(plan, { method: "PATCH", url, request: meta, lock: lock?.path ?? null });
  confirm(flag(values, "yes"), plan);
  const key = apiKey();
  const body = multipart([["request", JSON.stringify(meta)]], files);
  const entry = {
    id: crypto.randomUUID().replaceAll("-", ""),
    sha256: sha,
    file: file ? relPath(file) : null,
    assetType,
    assetId,
    update: true,
    state: "sending",
    uploadedAt: utcNow(),
  };
  await sendAsset(waitFlags(values, 600), { key, method: "PATCH", url, body, lock: files.length > 0 ? lock : undefined, entry });
}

async function cmdOperation(values: Values, [ref = ""]: string[]): Promise<void> {
  const key = apiKey();
  const timeout = seconds(values, "timeout", 300);
  const result = await waitFor(operationUrl(ref), key, timeout, (r) => r.done === true || TERMINAL.has(asText(r.state)));
  const outcome = assetOutcome(result);
  if (outcome) {
    let opRef = ref.trim();
    if (opRef.startsWith("/assets/v1/")) opRef = opRef.slice("/assets/v1/".length);
    else if (!opRef.includes("/")) opRef = `operations/${opRef}`;
    const lock = openLock(lockFlags(values), false);
    if (lock && (await lock.update({ operation: opRef }, outcome)) > 0) note(`updated ${lock.path}`);
  }
  out(result);
  const state = asText(result.state);
  if (!(result.done === true || TERMINAL.has(state))) throw new Fail(5, `still running after ${timeout}s`);
  if (result.error || state === "FAILED" || state === "CANCELLED") {
    throw new Fail(1, result.error ? "the operation failed" : `task ${state}`, { detail: result.error });
  }
}

async function cmdPublish(values: Values): Promise<void> {
  const file = need(values, "file");
  const ext = extname(file).toLowerCase();
  const types: Record<string, string> = { ".rbxl": "application/octet-stream", ".rbxlx": "application/xml" };
  const contentType = types[ext];
  if (!contentType || !isFile(file)) throw new Fail(2, "--file must be an existing .rbxl or .rbxlx place file");
  const universe = required("ROBLOX_UNIVERSE_ID", text(values, "universe"), "--universe");
  const place = required("ROBLOX_PLACE_ID", text(values, "place"), "--place");
  const data = new Uint8Array(readFileSync(file));
  const saved = flag(values, "saved");
  const versionType = saved ? "Saved" : "Published";
  const url = urlFor(`/universes/v1/${universe}/places/${place}/versions`, [["versionType", versionType]]);
  const plan: Json = {
    method: "POST",
    url,
    versionType,
    file: { path: file, bytes: data.length, sha256: sha256(data) },
    caveat: PUBLISH_CAVEAT,
    effect: `Saves a new place version${saved ? "." : " and makes it live for new servers."}`,
  };
  if (ext === ".rbxlx") {
    const found = [...new Set(Array.from(new TextDecoder().decode(data).matchAll(PUBLISH_SKIPPED), (m) => m[1] ?? ""))].sort();
    plan.classesNotUpdatedByThisRoute = found;
    if (found.length > 0) note(`this place contains ${found.join(", ")}: ${PUBLISH_CAVEAT}`);
  } else {
    note(PUBLISH_CAVEAT);
  }
  confirm(flag(values, "yes"), plan);
  const key = apiKey();
  const { body } = await http("POST", url, { key, body: data, headers: { "Content-Type": contentType } });
  out(parse(body));
}

async function cmdLuau(values: Values): Promise<void> {
  const inline = text(values, "script");
  const scriptFile = text(values, "script-file");
  if (inline !== undefined && scriptFile !== undefined) throw new Fail(2, "use --script-file or --script, not both");
  if (inline === undefined && !scriptFile) throw new Fail(2, "give --script-file FILE or --script CODE");
  const script = inline ?? readFileSync(scriptFile ?? "", "utf8");
  const size = new TextEncoder().encode(script).length;
  if (size > MAX_SCRIPT) throw new Fail(2, "the script is larger than 4 MB");
  const universe = required("ROBLOX_UNIVERSE_ID", text(values, "universe"), "--universe");
  const place = required("ROBLOX_PLACE_ID", text(values, "place"), "--place");
  const version = text(values, "version");
  const base = `/cloud/v2/universes/${universe}/places/${place}${version ? `/versions/${version}` : ""}`;
  const url = urlFor(`${base}/luau-execution-session-tasks`);
  const task: Json = { script };
  const taskTimeout = text(values, "task-timeout");
  if (taskTimeout !== undefined && !/^\d+$/.test(taskTimeout)) throw new Fail(2, "--task-timeout must be whole seconds (1-300)");
  if (Number(taskTimeout) > 0) task.timeout = `${Number(taskTimeout)}s`;
  const plan: Json = {
    method: "POST",
    url,
    scriptBytes: size,
    scriptSha256: sha256(script),
    timeout: task.timeout ?? "300s (default)",
    callsThatChangeThings: [...new Set(Array.from(script.matchAll(LUAU_WRITES), (m) => m[1] ?? ""))].sort(),
    effect:
      "Runs on Roblox servers against the saved place version. DataStore, MessagingService and HTTP calls act on live data; " +
      "DataModel changes are discarded unless the script calls AssetService:SavePlaceAsync.",
  };
  if (size <= 2000) plan.script = script;
  else Object.assign(plan, { scriptHead: script.slice(0, 1000), scriptTail: script.slice(-500) });
  confirm(flag(values, "yes"), plan);
  const key = apiKey();
  const created = parse((await http("POST", url, { key, body: JSON.stringify(task), headers: { "Content-Type": "application/json" } })).body);
  const taskPath = isRecord(created) ? asText(created.path) : "";
  if (!taskPath) throw new Fail(1, "Luau Execution returned no task path", { detail: created });
  if (flag(values, "no-wait")) {
    out(created);
    return;
  }
  const timeout = seconds(values, "timeout", 420);
  const result = await waitFor(urlFor(`/cloud/v2/${taskPath}`), key, timeout, (r) => TERMINAL.has(asText(r.state)));
  const state = asText(result.state);
  const logs = TERMINAL.has(state) ? await taskLogs(taskPath, key) : [];
  out({ path: taskPath, state: result.state ?? null, output: result.output ?? null, error: result.error ?? null, logs });
  if (!TERMINAL.has(state)) throw new Fail(5, `task still ${state} after ${timeout}s; poll with \`oc.ts operation ${taskPath}\``);
  if (state !== "COMPLETE") throw new Fail(1, `task ${state}`, { detail: result.error });
}

async function taskLogs(taskPath: string, key: string): Promise<unknown[]> {
  const messages: unknown[] = [];
  let token = "";
  for (;;) {
    const page = parse((await http("GET", urlFor(`/cloud/v2/${taskPath}/logs`, token ? [["pageToken", token]] : undefined), { key })).body);
    const chunks = isRecord(page) && Array.isArray(page.luauExecutionSessionTaskLogs) ? page.luauExecutionSessionTaskLogs : [];
    for (const chunk of chunks) if (isRecord(chunk) && Array.isArray(chunk.messages)) messages.push(...chunk.messages);
    token = isRecord(page) ? asText(page.nextPageToken) : "";
    if (!token) return messages;
  }
}

async function cmdDownload(values: Values): Promise<void> {
  const assetId = need(values, "asset-id");
  const dest = need(values, "out");
  if (existsSync(dest) && !flag(values, "force")) throw new Fail(2, `${dest} exists; pass --force to overwrite it`);
  const version = text(values, "version");
  const key = apiKey();
  const meta = parse((await http("GET", urlFor(`/asset-delivery-api/v1/assetId/${assetId}${version ? `/version/${version}` : ""}`), { key })).body);
  const location = isRecord(meta) ? asText(meta.location) : "";
  if (!isRecord(meta) || !location) throw new Fail(1, "no download location in the response", { detail: meta });
  const cdn = await http("GET", location, { headers: { "Accept-Encoding": "gzip" } }); // CDN: no key
  // fetch undoes a gzip Content-Encoding itself; this catches gzip content served without that header
  const data = cdn.body[0] === 0x1f && cdn.body[1] === 0x8b ? Bun.gunzipSync(cdn.body) : cdn.body;
  mkdirSync(dirname(resolve(dest)), { recursive: true });
  writeFileSync(dest, data);
  const rest = Object.fromEntries(Object.entries(meta).filter(([k]) => k !== "location"));
  out({ assetId, version: version ?? null, out: dest, bytes: data.length, sha256: sha256(data), meta: rest });
}

async function cmdUniverseId(values: Values): Promise<void> {
  const place = need(values, "place");
  out(parse((await http("GET", urlFor(`/universes/v1/places/${place}/universe`))).body));
}

// ---------- CLI ----------

type Option = { type: "string" | "boolean"; multiple?: boolean; help: string };
type Command = { usage: string; positionals: number; options: Record<string, Option>; run: (values: Values, positionals: string[]) => Promise<void> };

const YES: Record<string, Option> = { yes: { type: "boolean", help: "send it (only after the user agreed to the dry-run plan)" } };
const LOCK: Record<string, Option> = {
  lock: { type: "string", help: `upload lock file outside a git repository (inside: always ${LOCK_NAME} at its root)` },
  "no-lock": { type: "boolean", help: "no upload lock (only allowed outside a git repository)" },
  force: { type: "boolean", help: "upload even if the lock already has this file" },
};
const WAIT = (defaultSeconds: number): Record<string, Option> => ({
  timeout: { type: "string", help: `seconds to wait (default ${defaultSeconds})` },
  "no-wait": { type: "boolean", help: "return right after the request is accepted" },
});
const CREATOR: Option = { type: "string", help: "user:<userId> or group:<groupId> (default ROBLOX_CREATOR)" };
const UNIVERSE: Option = { type: "string", help: "universe ID (default ROBLOX_UNIVERSE_ID)" };
const PLACE: Option = { type: "string", help: "place ID (default ROBLOX_PLACE_ID)" };

const COMMANDS: Record<string, Command> = {
  introspect: { usage: "introspect", positionals: 0, options: {}, run: cmdIntrospect },
  request: {
    usage: "request METHOD PATH (path relative to https://apis.roblox.com)",
    positionals: 2,
    options: {
      query: { type: "string", multiple: true, help: "query parameter K=V (repeatable)" },
      json: { type: "string", help: "JSON request body" },
      "json-file": { type: "string", help: "file with the JSON request body" },
      form: { type: "string", multiple: true, help: "multipart text field K=V (repeatable)" },
      "form-file": { type: "string", multiple: true, help: "multipart file field K=PATH (repeatable)" },
      ...YES,
    },
    run: cmdRequest,
  },
  upload: {
    usage: "upload --file F --name N",
    positionals: 0,
    options: {
      file: { type: "string", help: "file to upload" },
      name: { type: "string", help: "display name" },
      description: { type: "string", help: "description" },
      type: { type: "string", help: `asset type: ${ASSET_TYPES.join(", ")} (default from the extension: images Image, fbx/gltf/glb Model)` },
      creator: CREATOR,
      ...LOCK,
      ...WAIT(600),
      ...YES,
    },
    run: cmdUpload,
  },
  "update-asset": {
    usage: "update-asset --asset-id ID [--file F.fbx] [--name N] [--description D]",
    positionals: 0,
    options: {
      "asset-id": { type: "string", help: "asset to update" },
      file: { type: "string", help: ".fbx with the new content" },
      name: { type: "string", help: "new display name" },
      description: { type: "string", help: "new description" },
      type: { type: "string", help: "asset type (default Model with --file; required otherwise)" },
      creator: CREATOR,
      ...LOCK,
      ...WAIT(600),
      ...YES,
    },
    run: cmdUpdateAsset,
  },
  operation: {
    usage: "operation PATH|ID (operations/<id>, <id>, a v2 path universes/..., cloud/v2/..., or /full/path)",
    positionals: 1,
    options: {
      timeout: { type: "string", help: "seconds to wait (default 300)" },
      lock: { type: "string", help: "upload lock to update when an asset operation finishes" },
      "no-lock": { type: "boolean", help: "do not update the upload lock" },
    },
    run: cmdOperation,
  },
  publish: {
    usage: "publish --file F.rbxl|F.rbxlx",
    positionals: 0,
    options: {
      file: { type: "string", help: "place file" },
      universe: UNIVERSE,
      place: PLACE,
      saved: { type: "boolean", help: "versionType=Saved: save without publishing" },
      ...YES,
    },
    run: cmdPublish,
  },
  luau: {
    usage: "luau --script-file F | --script CODE",
    positionals: 0,
    options: {
      "script-file": { type: "string", help: "Luau file to run" },
      script: { type: "string", help: "Luau code to run" },
      universe: UNIVERSE,
      place: PLACE,
      version: { type: "string", help: "place version number (default: the latest version; which one is unverified)" },
      "task-timeout": { type: "string", help: "script time limit in seconds, 1-300 (default 300)" },
      ...WAIT(420),
      ...YES,
    },
    run: cmdLuau,
  },
  download: {
    usage: "download --asset-id ID --out FILE",
    positionals: 0,
    options: {
      "asset-id": { type: "string", help: "asset to download" },
      version: { type: "string", help: "asset version (default latest)" },
      out: { type: "string", help: "where to write the content" },
      force: { type: "boolean", help: "overwrite --out" },
    },
    run: cmdDownload,
  },
  "universe-id": { usage: "universe-id --place P", positionals: 0, options: { place: { type: "string", help: "place ID" } }, run: cmdUniverseId },
};

function usage(command: Command): string {
  const flags = Object.entries(command.options).map(([name, o]) => ({ flag: `--${name}${o.type === "string" ? " VALUE" : ""}`, help: o.help }));
  const width = Math.max(0, ...flags.map(({ flag }) => flag.length));
  const lines = flags.map(({ flag, help }) => `  ${flag.padEnd(width)}  ${help}`);
  return [`usage: oc.ts ${command.usage}`, ...(lines.length > 0 ? ["", "options:", ...lines] : [])].join("\n");
}

async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (name === "--help" || name === "-h") {
    console.log(HELP);
    return 0;
  }
  const command = name === undefined ? undefined : COMMANDS[name];
  if (!command) {
    if (name !== undefined) note(`unknown command ${JSON.stringify(name)}`);
    console.error(HELP);
    return 2;
  }
  try {
    const options = Object.fromEntries(Object.entries(command.options).map(([key, o]) => [key, { type: o.type, multiple: o.multiple ?? false }]));
    let values: Values;
    let positionals: string[];
    try {
      ({ values, positionals } = parseArgs({ args: rest, options: { ...options, help: { type: "boolean", short: "h" } }, allowPositionals: true }));
    } catch (error) {
      throw new Fail(2, `${error instanceof Error ? error.message : String(error)}\n${usage(command)}`);
    }
    if (values.help === true) {
      console.log(usage(command));
      return 0;
    }
    if (positionals.length !== command.positionals) throw new Fail(2, `wrong number of arguments\n${usage(command)}`);
    await command.run(values, positionals);
    return 0;
  } catch (error) {
    if (error instanceof Fail) {
      note(error.message);
      if (error.detail !== undefined && error.detail !== null) {
        console.error(redact(typeof error.detail === "string" ? error.detail : JSON.stringify(error.detail, null, 2)));
      }
      return error.code;
    }
    note(`unexpected error: ${describe(error)}`); // note() redacts the key
    return 1;
  }
}

process.exit(await main(Bun.argv.slice(2)));
