/**
 * Offline tests for oc.ts against a local mock of the Open Cloud endpoints it calls.
 *
 * Run from the repo root: bun test .agents/skills/roblox-open-cloud-api/scripts
 * Nothing contacts Roblox: oc.ts is pointed at http://127.0.0.1:<port> through
 * ROBLOX_OPEN_CLOUD_BASE_URL, the key is fake, the Keychain lookup is disabled and every
 * ROBLOX_* and OPEN_CLOUD_* variable from the caller's environment is dropped.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const OC = join(import.meta.dir, "oc.ts");
const KEY = `FAKE-OPEN-CLOUD-KEY-${"k".repeat(40)}`;
const TASK = "universes/1/places/2/versions/3/luau-execution-sessions/s1/tasks/t1";

setDefaultTimeout(60_000);

function png(width: number, height: number): Buffer {
  const size = Buffer.alloc(8);
  size.writeUInt32BE(width, 0);
  size.writeUInt32BE(height, 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
    Buffer.from("IHDR"),
    size,
    Buffer.from([8, 6, 0, 0, 0, 0, 0, 0, 0]),
    Buffer.from("rest-of-file"),
  ]);
}

const sha256 = (data: Buffer): string => createHash("sha256").update(data).digest("hex");

function nth<T>(items: T[], index: number): T {
  const item = items.at(index);
  if (item === undefined) throw new Error(`expected an item at ${index}, got ${items.length} items`);
  return item;
}

// ---------- mock Open Cloud ----------

/** A queued answer; the last one for a route repeats. `delay` (seconds) answers late, `drop` closes without answering. */
type Reply = { code?: number; json?: unknown; raw?: Buffer; headers?: Record<string, string>; delay?: number; drop?: boolean };
type Call = { method: string; path: string; body: Buffer; headers: Record<string, string> };

const routes = new Map<string, Reply[]>();
const received: Call[] = [];
let server: Server;
let base = "";

function handle(req: IncomingMessage, res: ServerResponse): void {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", async () => {
    const method = req.method ?? "";
    const path = req.url ?? "";
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers[name] = value;
    received.push({ method, path, body: Buffer.concat(chunks), headers });
    const queue = routes.get(`${method} ${path.split("?")[0]}`);
    const reply: Reply = (queue && (queue.length > 1 ? queue.shift() : queue[0])) ?? { code: 404, json: { code: "NOT_FOUND" } };
    if (reply.delay) await Bun.sleep(reply.delay * 1000);
    if (reply.drop) {
      req.socket.destroy();
      return;
    }
    const raw = reply.raw ?? Buffer.from(reply.json === undefined ? "" : JSON.stringify(reply.json));
    const type: Record<string, string> = reply.json === undefined ? {} : { "Content-Type": "application/json" };
    res.writeHead(reply.code ?? 200, { ...reply.headers, ...type, "Content-Length": String(raw.length) });
    res.end(raw);
  });
}

function route(method: string, path: string, ...replies: Reply[]): void {
  routes.set(`${method} ${path}`, replies);
}

const calls = (method?: string): Call[] => received.filter((c) => method === undefined || c.method === method);

/** The parts of a multipart body as sent, read from their own headers (Bun's formData() guesses
 * file types from the filename, which would hide a missing Content-Type). */
function formParts(call: Call): Record<string, { filename: string | null; type: string; data: Buffer }> {
  const boundary = /boundary="?([^";]+)"?/.exec(call.headers["content-type"] ?? "")?.[1];
  if (!boundary) throw new Error(`not a multipart request: ${call.headers["content-type"]}`);
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Record<string, { filename: string | null; type: string; data: Buffer }> = {};
  for (let at = call.body.indexOf(delimiter); at !== -1; ) {
    const next = call.body.indexOf(delimiter, at + delimiter.length);
    if (next === -1) break;
    const part = call.body.subarray(at + delimiter.length + 2, next - 2); // CRLF after this delimiter and before the next
    const split = part.indexOf("\r\n\r\n");
    const head = part.subarray(0, split).toString();
    parts[/[;\s]name="([^"]*)"/.exec(head)?.[1] ?? ""] = {
      filename: /filename="([^"]*)"/.exec(head)?.[1] ?? null,
      type: /^content-type:\s*(.+)$/im.exec(head)?.[1]?.trim() ?? "text/plain",
      data: Buffer.from(part.subarray(split + 4)),
    };
    at = next;
  }
  return parts;
}

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the mock server has no port");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
});

// ---------- a throwaway project per test ----------

let root = "";

beforeEach(() => {
  received.length = 0;
  routes.clear();
  root = mkdtempSync(join(tmpdir(), "oc-test-"));
  mkdirSync(join(root, ".git"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

type RunOptions = { env?: Record<string, string>; key?: boolean; base?: boolean; cwd?: string };
type Run = { code: number; stdout: string; stderr: string };

function environment({ env = {}, key = true, base: testMode = true }: RunOptions): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !name.startsWith("ROBLOX_") && !name.startsWith("OPEN_CLOUD_")) result[name] = value;
  }
  result.ROBLOX_CREATOR = "user:42";
  if (testMode) result.ROBLOX_OPEN_CLOUD_BASE_URL = base;
  if (key) result.OPEN_CLOUD_API_KEY = KEY;
  return { ...result, ...env };
}

/** Start oc.ts without waiting: the mock server runs in this process, so the event loop must stay free. */
function start(args: string[], options: RunOptions = {}) {
  return Bun.spawn([process.execPath, OC, ...args], { cwd: options.cwd ?? root, env: environment(options), stdout: "pipe", stderr: "pipe" });
}

async function finish(proc: ReturnType<typeof start>): Promise<Run> {
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(stdout).not.toContain(KEY);
  expect(stderr).not.toContain(KEY);
  return { code, stdout, stderr };
}

const oc = (args: string[], options: RunOptions = {}): Promise<Run> => finish(start(args, options));

function write(name: string, data: Buffer | string): void {
  writeFileSync(join(root, name), data);
}

const LOCK = "roblox-uploads.lock.json"; // at the repository root

function lock(): { uploads: Record<string, unknown>[] } {
  return JSON.parse(readFileSync(join(root, LOCK), "utf8"));
}

// ---------- the key ----------

test("introspect sends the key only in the body", async () => {
  route("POST", "/api-keys/v1/introspect", { json: { name: "k", enabled: true, scopes: [] } });

  const r = await oc(["introspect"]);

  expect(r).toMatchObject({ code: 0 });
  expect(JSON.parse(r.stdout).name).toBe("k");
  const call = nth(calls(), 0);
  expect(JSON.parse(call.body.toString()).apiKey).toBe(KEY);
  expect(call.headers["x-api-key"]).toBeUndefined();
});

test("the shell's key wins over a .env in the working folder", async () => {
  write(".env", "OPEN_CLOUD_API_KEY=DOTENV-KEY-NOT-THIS-ONE\n"); // Bun loads it only for unset variables
  route("POST", "/api-keys/v1/introspect", { json: { name: "k" } });

  expect(await oc(["introspect"])).toMatchObject({ code: 0 });

  expect(JSON.parse(nth(calls(), 0).body.toString()).apiKey).toBe(KEY);
});

test("explains a missing key without calling Roblox", async () => {
  const r = await oc(["introspect"], { key: false });

  expect(r.code).toBe(2);
  expect(r.stderr).toContain("OPEN_CLOUD_API_KEY is not set");
  expect(calls()).toEqual([]);
});

test("reads defaults from the environment and lets flags override them", async () => {
  write("c.png", png(8, 8));
  write("p.rbxl", "<roblox!binary");
  const env = { ROBLOX_CREATOR: "group:9", ROBLOX_UNIVERSE_ID: "1", ROBLOX_PLACE_ID: "2" };

  const fromEnv = await oc(["upload", "--file", "c.png", "--name", "c"], { env });
  expect(JSON.parse(fromEnv.stdout).plan.request.creationContext).toEqual({ creator: { groupId: "9" } });
  const fromFlag = await oc(["upload", "--file", "c.png", "--name", "c", "--creator", "user:5"], { env });
  expect(JSON.parse(fromFlag.stdout).plan.request.creationContext).toEqual({ creator: { userId: "5" } });

  const publish = await oc(["publish", "--file", "p.rbxl"], { env });
  expect(JSON.parse(publish.stdout).plan.url).toContain("/universes/v1/1/places/2/versions");
  const flagged = await oc(["publish", "--file", "p.rbxl", "--universe", "7", "--place", "8"], { env });
  expect(JSON.parse(flagged.stdout).plan.url).toContain("/universes/v1/7/places/8/versions");
  expect(calls()).toEqual([]);
});

test("refuses a malformed key without printing it", async () => {
  const r = await oc(["introspect"], { env: { OPEN_CLOUD_API_KEY: "PARTONE-SECRET\nPARTTWO-SECRET" } });

  expect(r.code).toBe(2);
  for (const part of ["PARTONE-SECRET", "PARTTWO-SECRET"]) expect(r.stdout + r.stderr).not.toContain(part);
  expect(calls()).toEqual([]);
});

test("redacts the key when a response echoes it", async () => {
  route("GET", "/cloud/v2/universes/1", { code: 400, json: { message: `bad key ${KEY}` } });

  const r = await oc(["request", "GET", "/cloud/v2/universes/1"]); // oc() also asserts the key is not printed

  expect(r.code).toBe(1);
  expect(r.stderr).toContain("bad key ***");
});

test("never sends the key to another host, over http, or to localhost outside test mode", async () => {
  for (const url of ["https://example.com/steal", "http://apis.roblox.com/cloud/v2/universes/1", "http://127.0.0.1:9/other-local-origin"]) {
    const r = await oc(["request", "GET", url]);
    expect({ url, code: r.code }).toEqual({ url, code: 2 });
    expect(r.stderr).toContain("refusing");
  }

  const local = await oc(["request", "GET", `${base}/anything`], { base: false });
  expect(local.code).toBe(2);
  expect(local.stderr).toContain("non-https");
  expect(calls()).toEqual([]);
});

test("does not follow a redirect while the key is attached", async () => {
  route("GET", "/cloud/v2/universes/1", { code: 302, headers: { Location: `${base}/elsewhere` } });
  route("GET", "/elsewhere", { json: {} });

  const r = await oc(["request", "GET", "/cloud/v2/universes/1"]);

  expect(r.code).toBe(1);
  expect(calls().map((c) => c.path)).toEqual(["/cloud/v2/universes/1"]);
});

test("download sends no key to the CDN and does not overwrite", async () => {
  const content = Buffer.from("version 4.00\nmesh bytes");
  route("GET", "/asset-delivery-api/v1/assetId/5", { json: { location: `${base}/cdn/5`, assetTypeId: 4 } });
  route("GET", "/cdn/5", { raw: gzipSync(content), headers: { "Content-Encoding": "gzip" } });

  expect(await oc(["download", "--asset-id", "5", "--out", "mesh.bin"])).toMatchObject({ code: 0 });

  expect(readFileSync(join(root, "mesh.bin"))).toEqual(content);
  expect(nth(calls(), 0).headers["x-api-key"]).toBe(KEY);
  expect(nth(calls(), 1).headers["x-api-key"]).toBeUndefined();
  expect((await oc(["download", "--asset-id", "5", "--out", "mesh.bin"])).code).toBe(2);
});

test("refuses payment and billing endpoints in any spelling", async () => {
  const r = await oc(["request", "POST", "/service-efficiency-api/v1/payments/users/1", "--json", "{}", "--yes"]);
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("never called");

  for (const [method, path] of [
    ["GET", "/service-efficiency-api/v1/payment_profiles/users/1"],
    ["POST", "/service-efficiency-api/v1/Payments/users/1"],
    ["POST", "/service-efficiency-api/v1/%70ayments/users/1"],
    ["POST", "/service%2Defficiency-api/v1/payments/users/1%ZZ"],
    ["POST", "/service-efficiency-api/v1//payments/users/1"],
    ["POST", "/SERVICE-EFFICIENCY-API/v1/payments/users/1"],
    ["POST", "/cloud/v2/%2e%2e/%2e%2e/service-efficiency-api/v1/payments/users/1"],
    ["PUT", "/service-efficiency-api/v1/accounts/users/1"],
    ["GET", "/ads-management/v1/billing-accounts"],
  ] as const) {
    const refused = await oc(["request", method, path, "--yes"]);
    expect({ path, code: refused.code, never: refused.stderr.includes("never called") }).toEqual({ path, code: 2, never: true });
  }
  expect(calls()).toEqual([]);
});

test("refuses payment endpoints reached through an ID in another command's path", async () => {
  const r = await oc(["update-asset", "--asset-id", "1/../../../../service-efficiency-api/v1/payments", "--type", "Image", "--name", "x", "--yes"]);

  expect(r.code).toBe(2);
  expect(r.stderr).toContain("never called");
  expect(calls()).toEqual([]);
});

// ---------- dry runs ----------

test("writes are dry runs without --yes", async () => {
  write("tex.png", png(64, 64));

  const upload = await oc(["upload", "--file", "tex.png", "--name", "tex"]);
  expect(upload.code).toBe(3);
  const plan = JSON.parse(upload.stdout);
  expect(plan.dryRun).toBe(true);
  expect(plan.plan.request.assetType).toBe("Image");

  expect((await oc(["request", "POST", "/cloud/v2/universes/1:restartServers", "--json", "{}"])).code).toBe(3);
  expect(calls()).toEqual([]);
  expect(existsSync(join(root, LOCK))).toBe(false);
});

test("reading a memory-store queue needs --yes in any spelling", async () => {
  const path = "/cloud/v2/universes/1/memory-store/queues/q/items:read";
  for (const variant of [path, path.replace("items:read", "Items:read"), path.replace("/queues/", "//queues/")]) {
    const r = await oc(["request", "GET", variant, "--query", "count=5"]);
    expect({ variant, code: r.code }).toEqual({ variant, code: 3 });
  }
  expect(calls()).toEqual([]);

  route("GET", path, { json: { memoryStoreQueueItems: [] } });
  expect(await oc(["request", "GET", path, "--yes"])).toMatchObject({ code: 0 });
});

// ---------- uploads and the lock ----------

test("an image upload polls the operation and records the lock", async () => {
  const data = png(64, 64);
  write("tex.png", data);
  route("POST", "/assets/v1/assets", { json: { path: "operations/op1", done: false } });
  const done = {
    path: "operations/op1",
    done: true,
    response: { assetId: "999", revisionId: "1", moderationResult: { moderationState: "MODERATION_STATE_APPROVED" } },
  };
  route("GET", "/assets/v1/operations/op1", { json: { path: "operations/op1", done: false } }, { json: done });

  const r = await oc(["upload", "--file", "tex.png", "--name", "tex", "--yes"]);

  expect(r).toMatchObject({ code: 0 });
  expect(JSON.parse(r.stdout).result).toMatchObject({ assetId: "999", rbxassetid: "rbxassetid://999" });
  const post = nth(calls("POST"), 0);
  expect(post.headers["x-api-key"]).toBe(KEY);
  const parts = formParts(post);
  const meta = JSON.parse(String(parts.request?.data));
  expect(meta.assetType).toBe("Image");
  expect(meta.creationContext).toEqual({ creator: { userId: "42" } });
  expect(parts.fileContent).toEqual({ filename: "tex.png", type: "image/png", data });
  expect(nth(lock().uploads, 0)).toMatchObject({
    sha256: sha256(data),
    state: "done",
    assetId: "999",
    file: "tex.png",
    moderationState: "MODERATION_STATE_APPROVED",
  });
});

test("refuses a file already in the lock unless --force", async () => {
  const data = png(32, 32);
  write("tex.png", data);
  write(
    LOCK,
    JSON.stringify({ version: 1, uploads: [{ sha256: sha256(data), state: "done", assetId: "5", operation: "operations/x" }] }),
  );

  const refused = await oc(["upload", "--file", "tex.png", "--name", "tex", "--yes"]);
  expect(refused.code).toBe(4);
  expect(JSON.parse(refused.stdout).existing.assetId).toBe("5");
  expect(calls()).toEqual([]);

  route("POST", "/assets/v1/assets", { json: { path: "operations/op9", done: true, response: { assetId: "6" } } });
  expect(await oc(["upload", "--file", "tex.png", "--name", "tex", "--yes", "--force"])).toMatchObject({ code: 0 });
  expect(lock().uploads).toHaveLength(2);
});

test("--no-lock is refused inside the project", async () => {
  write("n.png", png(8, 8));

  const r = await oc(["upload", "--file", "n.png", "--name", "n", "--no-lock", "--yes"]);

  expect(r.code).toBe(2);
  expect(r.stderr).toContain("mandatory");
  expect(calls()).toEqual([]);
});

test("the lock cannot be redirected inside the project", async () => {
  write("n.png", png(8, 8));
  for (const [args, env] of [
    [["--lock", "other.json"], {}],
    [[], { ROBLOX_UPLOAD_LOCK: join(root, "other.json") }],
  ] as const) {
    const r = await oc(["upload", "--file", "n.png", "--name", "n", "--yes", ...args], { env });
    expect({ args, code: r.code, bypass: r.stderr.includes("bypass") }).toEqual({ args, code: 2, bypass: true });
  }

  // naming the project lock itself is fine
  expect(await oc(["upload", "--file", "n.png", "--name", "n", "--lock", LOCK])).toMatchObject({ code: 3 });
  expect(calls()).toEqual([]);
});

async function closedPort(): Promise<number> {
  const probe = createTcpServer();
  await new Promise<void>((done) => probe.listen(0, "127.0.0.1", done));
  const address = probe.address();
  if (address === null || typeof address === "string") throw new Error("the probe has no port");
  await new Promise<void>((done) => probe.close(() => done()));
  return address.port; // nothing listens there now: connections are refused before anything is sent
}

test("an unreachable server records failed, so a retry is allowed", async () => {
  const env = { ROBLOX_OPEN_CLOUD_BASE_URL: `http://127.0.0.1:${await closedPort()}` };
  write("u.png", png(14, 14));

  for (let attempt = 0; attempt < 2; attempt++) {
    expect(await oc(["upload", "--file", "u.png", "--name", "u", "--yes"], { env })).toMatchObject({ code: 1 }); // 1 both times: the lock never blocks it
  }
  expect(lock().uploads.map((u) => u.state)).toEqual(["failed", "failed"]);
});

test("concurrent uploads keep both lock entries", async () => {
  write("a.png", png(10, 10));
  write("b.png", png(11, 11));
  route(
    "POST",
    "/assets/v1/assets",
    { delay: 2, json: { path: "operations/a", done: true, response: { assetId: "1" } } },
    { json: { path: "operations/b", done: true, response: { assetId: "2" } } },
  );

  const first = start(["upload", "--file", "a.png", "--name", "a", "--yes"]);
  const deadline = performance.now() + 30_000;
  while (calls("POST").length === 0 && performance.now() < deadline) await Bun.sleep(50);
  expect(await oc(["upload", "--file", "b.png", "--name", "b", "--yes"])).toMatchObject({ code: 0 });
  expect(await finish(first)).toMatchObject({ code: 0 });

  expect(lock().uploads.map((u) => u.assetId).sort()).toEqual(["1", "2"]);
});

test("a lock mutex left by a dead process does not block uploads", async () => {
  const gone = Bun.spawn(["true"]);
  await gone.exited;
  write(`${LOCK}.mutex.tmp`, String(gone.pid));
  write("s.png", png(15, 15));
  route("POST", "/assets/v1/assets", { json: { path: "operations/s", done: true, response: { assetId: "4" } } });

  expect(await oc(["upload", "--file", "s.png", "--name", "s", "--yes"])).toMatchObject({ code: 0 });

  expect(lock().uploads.map((u) => u.state)).toEqual(["done"]);
  expect(existsSync(join(root, `${LOCK}.mutex.tmp`))).toBe(false);
});

test("a dropped upload is unknown and blocks a retry until --force", async () => {
  write("d.png", png(12, 12));
  route("POST", "/assets/v1/assets", { drop: true });

  expect((await oc(["upload", "--file", "d.png", "--name", "d", "--yes"])).code).toBe(1);
  expect(calls("POST")).toHaveLength(1); // a write is never retried after a network error
  expect(nth(lock().uploads, 0).state).toBe("unknown");

  const retry = await oc(["upload", "--file", "d.png", "--name", "d", "--yes"]);
  expect(retry.code).toBe(4);
  expect(retry.stderr).toContain("unknown");

  route("POST", "/assets/v1/assets", { json: { path: "operations/d2", done: true, response: { assetId: "8" } } });
  expect(await oc(["upload", "--file", "d.png", "--name", "d", "--yes", "--force"])).toMatchObject({ code: 0 });
  expect(lock().uploads.map((u) => u.state)).toEqual(["unknown", "done"]);
});

test("a rejected upload is failed and can be retried", async () => {
  write("r.png", png(13, 13));
  route("POST", "/assets/v1/assets", { code: 400, json: { code: "INVALID_ARGUMENT" } });

  expect((await oc(["upload", "--file", "r.png", "--name", "r", "--yes"])).code).toBe(1);
  expect(nth(lock().uploads, 0).state).toBe("failed");

  route("POST", "/assets/v1/assets", { json: { path: "operations/r2", done: true, response: { assetId: "9" } } });
  expect(await oc(["upload", "--file", "r.png", "--name", "r", "--yes"])).toMatchObject({ code: 0 });
});

test("a pending upload blocks a retry and `operation` finishes it", async () => {
  write("charm.fbx", "Kaydara FBX Binary  fake");
  route("POST", "/assets/v1/assets", { json: { path: "operations/op2", done: false } });

  expect(await oc(["upload", "--file", "charm.fbx", "--name", "charm", "--yes", "--no-wait"])).toMatchObject({ code: 0 });
  expect(nth(lock().uploads, 0).state).toBe("pending");
  expect(formParts(nth(calls("POST"), 0)).fileContent?.type).toBe("model/fbx");

  const retry = await oc(["upload", "--file", "charm.fbx", "--name", "charm", "--yes"]);
  expect(retry.code).toBe(4);
  expect(retry.stderr).toContain("still processing");

  route("GET", "/assets/v1/operations/op2", { json: { path: "operations/op2", done: true, response: { assetId: "77" } } });
  expect(await oc(["operation", "operations/op2"])).toMatchObject({ code: 0 });
  expect(nth(lock().uploads, 0)).toMatchObject({ state: "done", assetId: "77" });
});

test("rate limits are retried but server errors on writes are not", async () => {
  write("a.png", png(8, 8));
  route(
    "POST",
    "/assets/v1/assets",
    { code: 429, json: { errors: [{ message: "slow down" }] }, headers: { "Retry-After": "0" } },
    { json: { path: "operations/op3", done: true, response: { assetId: "3" } } },
  );
  expect(await oc(["upload", "--file", "a.png", "--name", "a", "--yes"])).toMatchObject({ code: 0 });
  expect(calls("POST")).toHaveLength(2);

  received.length = 0;
  write("b.png", png(9, 9));
  route("POST", "/assets/v1/assets", { code: 500, json: { code: "INTERNAL" } });
  expect((await oc(["upload", "--file", "b.png", "--name", "b", "--yes"])).code).toBe(1);
  expect(calls("POST")).toHaveLength(1);
  expect(nth(lock().uploads, -1).state).toBe("unknown"); // a 5xx may still have created it
});

test("a GET is retried after a dropped connection and a long Retry-After fails fast", async () => {
  route("GET", "/cloud/v2/universes/1", { drop: true }, { json: { path: "universes/1" } });
  expect(await oc(["request", "GET", "/cloud/v2/universes/1"])).toMatchObject({ code: 0 });
  expect(calls()).toHaveLength(2);

  route("GET", "/cloud/v2/universes/2", { code: 429, json: {}, headers: { "Retry-After": "9999" } });
  const started = performance.now();
  const r = await oc(["request", "GET", "/cloud/v2/universes/2"]);
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("try again later");
  expect(performance.now() - started).toBeLessThan(30_000);
});

test("update-asset sends the FBX with an update mask", async () => {
  write("m.fbx", "Kaydara FBX Binary  v2");
  route("PATCH", "/assets/v1/assets/55", { json: { path: "operations/u1", done: true, response: { assetId: "55", revisionId: "2" } } });

  expect(await oc(["update-asset", "--asset-id", "55", "--file", "m.fbx", "--name", "New", "--yes"])).toMatchObject({ code: 0 });

  const call = nth(calls("PATCH"), 0);
  expect(call.path).toContain("updateMask=displayName");
  const meta = JSON.parse(String(formParts(call).request?.data));
  expect(meta).toMatchObject({ assetType: "Model", assetId: "55", displayName: "New" });
  expect(nth(lock().uploads, 0)).toMatchObject({ assetId: "55", revisionId: "2", update: true });
  write("m.png", png(8, 8));
  expect((await oc(["update-asset", "--asset-id", "55", "--file", "m.png"])).code).toBe(2);
});

test("a metadata update that returns the fields is final", async () => {
  route("PATCH", "/assets/v1/assets/55", { json: { displayName: "New", description: "d" } });
  const r = await oc(["update-asset", "--asset-id", "55", "--type", "Image", "--name", "New", "--yes"]);
  expect(r).toMatchObject({ code: 0 });
  expect(JSON.parse(r.stdout).response.displayName).toBe("New");

  route("PATCH", "/assets/v1/assets/56", { json: { path: "assets/56", assetId: "56", displayName: "X" } });
  expect(await oc(["update-asset", "--asset-id", "56", "--type", "Image", "--name", "X", "--yes"])).toMatchObject({ code: 0 });
  expect(calls()).toHaveLength(2); // nothing was polled
});

test("upload usage errors exit 2 before anything is sent", async () => {
  write("x.rbxm", "<roblox!");
  write("big.png", png(8000, 10));
  write("ok.png", png(8, 8));
  for (const [args, env] of [
    [["--file", "x.rbxm", "--name", "x"], {}], // rbxm needs --type
    [["--file", "ok.png", "--name", "x", "--type", "Model"], {}], // wrong type for the extension
    [["--file", "big.png", "--name", "x"], {}], // 8000 px
    [["--file", "ok.png", "--name", "x"], { ROBLOX_CREATOR: "" }], // no creator
  ] as const) {
    expect({ args, code: (await oc(["upload", ...args], { env })).code }).toEqual({ args, code: 2 });
  }

  expect(calls()).toEqual([]);
});

test("outside a git repository the lock must be named or switched off", async () => {
  const outside = mkdtempSync(join(tmpdir(), "oc-outside-")); // no .git above it
  try {
    writeFileSync(join(outside, "ok.png"), png(8, 8));

    const unnamed = await oc(["upload", "--file", "ok.png", "--name", "x"], { cwd: outside });
    expect(unnamed.code).toBe(2);
    expect(unnamed.stderr).toContain("no upload lock");
    const named = await oc(["upload", "--file", "ok.png", "--name", "x", "--lock", "uploads.json"], { cwd: outside });
    expect(JSON.parse(named.stdout).plan.lock).toBe("uploads.json");
    expect((await oc(["upload", "--file", "ok.png", "--name", "x", "--no-lock"], { cwd: outside })).code).toBe(3);
    expect(calls()).toEqual([]);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

// ---------- other commands ----------

test("operation exit codes and the memory-store flush path", async () => {
  route("GET", "/assets/v1/operations/bad", { json: { path: "operations/bad", done: true, error: { code: 3, message: "rejected" } } });
  expect((await oc(["operation", "operations/bad"])).code).toBe(1);

  route("GET", `/cloud/v2/${TASK}`, { json: { path: TASK, state: "FAILED" } });
  expect((await oc(["operation", TASK])).code).toBe(1);

  const flush = "cloud/v2/universes/1/memory-store/operations/f1";
  route("GET", `/${flush}`, { json: { path: flush, done: true } });
  expect(await oc(["operation", flush])).toMatchObject({ code: 0 });
  expect(nth(calls(), -1).path).toBe(`/${flush}`);
});

test("publish flags the classes the API does not update", async () => {
  const place = Buffer.from(
    '<roblox version="4"><Item class="Part" referent="A"></Item><Item class="SurfaceAppearance" referent="B"></Item></roblox>',
  );
  write("place.rbxlx", place);

  const dry = await oc(["publish", "--file", "place.rbxlx", "--universe", "1", "--place", "2"]);
  expect(dry.code).toBe(3);
  expect(JSON.parse(dry.stdout).plan).toMatchObject({ classesNotUpdatedByThisRoute: ["SurfaceAppearance"], versionType: "Published" });

  route("POST", "/universes/v1/1/places/2/versions", { json: { versionNumber: 7 } });
  const r = await oc(["publish", "--file", "place.rbxlx", "--universe", "1", "--place", "2", "--saved", "--yes"]);
  expect(r).toMatchObject({ code: 0 });
  expect(JSON.parse(r.stdout)).toEqual({ versionNumber: 7 });
  const call = nth(calls("POST"), 0);
  expect(call.path).toContain("versionType=Saved");
  expect(call.headers["content-type"]).toBe("application/xml");
  expect(call.body).toEqual(place);
});

test("the luau plan lists calls that change things", async () => {
  const script = 'game:GetService("DataStoreService"):GetDataStore("x"):SetAsync("k", 1)\ngame:GetService("AssetService"):SavePlaceAsync()';

  const r = await oc(["luau", "--script", script, "--universe", "1", "--place", "2"]);

  expect(r.code).toBe(3);
  expect(JSON.parse(r.stdout).plan).toMatchObject({ callsThatChangeThings: ["SavePlaceAsync", "SetAsync"], script });
});

test("a luau task returns its output and logs", async () => {
  route("POST", "/cloud/v2/universes/1/places/2/luau-execution-session-tasks", { json: { path: TASK, state: "QUEUED" } });
  route(
    "GET",
    `/cloud/v2/${TASK}`,
    { json: { path: TASK, state: "PROCESSING" } },
    { json: { path: TASK, state: "COMPLETE", output: { results: [7] } } },
  );
  route("GET", `/cloud/v2/${TASK}/logs`, { json: { luauExecutionSessionTaskLogs: [{ messages: ["hello"] }] } });
  const script = "print('hello') return 3 + 4";

  const r = await oc(["luau", "--script", script, "--universe", "1", "--place", "2", "--task-timeout", "30", "--yes"]);

  expect(r).toMatchObject({ code: 0 });
  expect(JSON.parse(r.stdout)).toMatchObject({ state: "COMPLETE", output: { results: [7] }, logs: ["hello"] });
  expect(JSON.parse(nth(calls("POST"), 0).body.toString())).toEqual({ script, timeout: "30s" });
});

test("a failed luau task exits 1", async () => {
  route("POST", "/cloud/v2/universes/1/places/2/versions/3/luau-execution-session-tasks", { json: { path: TASK } });
  route("GET", `/cloud/v2/${TASK}`, { json: { path: TASK, state: "FAILED", error: { code: "SCRIPT_ERROR", message: "boom" } } });
  route("GET", `/cloud/v2/${TASK}/logs`, { json: {} });

  const r = await oc(["luau", "--script", "error('boom')", "--universe", "1", "--place", "2", "--version", "3", "--yes"]);

  expect(r.code).toBe(1);
  expect(JSON.parse(r.stdout).state).toBe("FAILED");
  expect(r.stderr).toContain("boom");
});

test("request sends a multipart form", async () => {
  const icon = png(150, 150);
  write("icon.png", icon);
  route("POST", "/game-passes/v1/universes/1/game-passes", { json: { gamePassId: 11 } });

  const r = await oc([
    "request",
    "POST",
    "/game-passes/v1/universes/1/game-passes",
    "--form",
    "name=VIP",
    "--form",
    "price=100",
    "--form-file",
    "imageFile=icon.png",
    "--yes",
  ]);

  expect(r).toMatchObject({ code: 0 });
  expect(JSON.parse(r.stdout)).toEqual({ gamePassId: 11 });
  const parts = formParts(nth(calls("POST"), 0));
  expect(String(parts.name?.data)).toBe("VIP");
  expect(String(parts.price?.data)).toBe("100");
  expect(parts.imageFile).toMatchObject({ type: "image/png", data: icon });
});

test("universe-id sends no key", async () => {
  route("GET", "/universes/v1/places/2/universe", { json: { universeId: 1 } });

  const r = await oc(["universe-id", "--place", "2"]);

  expect(r).toMatchObject({ code: 0 });
  expect(JSON.parse(r.stdout)).toEqual({ universeId: 1 });
  expect(nth(calls(), 0).headers["x-api-key"]).toBeUndefined();
});
