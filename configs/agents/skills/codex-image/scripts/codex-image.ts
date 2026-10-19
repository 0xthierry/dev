#!/usr/bin/env bun
/**
 * Generate one image with the Codex CLI's built-in image tool (billed to the ChatGPT plan, not the API)
 * and save it as a PNG. Bun, no dependencies.
 *
 *   bun ~/.agents/skills/codex-image/scripts/codex-image.ts --prompt "..." --out images/hero.png
 *       [--prompt-file prompt.txt] [--ref input.png ...] [--transparent] [--tries 3] [--timeout 600]
 *       [--model <codex model>] [--effort low|medium|high] [--meta] [--dry-run]
 *
 * Codex runs headless with --dangerously-bypass-approvals-and-sandbox (the image tool and the copy step must
 * run without approval prompts) inside a new empty temporary folder, so it never works in the caller's project.
 * The image is saved there first, checked (PNG signature, size, alpha when --transparent), then copied to --out.
 * Prints one JSON line: {"ok":true,"out":...,"width":...,"height":...} or {"ok":false,"error":...,"log":...}.
 * Exit codes: 0 saved, 1 failed after all tries, 2 bad arguments.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";

type Options = {
  prompt: string;
  out: string;
  refs: string[];
  transparent: boolean;
  tries: number;
  timeout: number;
  model?: string;
  effort?: string;
  meta: boolean;
  dryRun: boolean;
};

const HELP = readFileSync(import.meta.path, "utf8").split("*/")[0].replace(/^#!.*\n\/\*\*\n/, "").replace(/^ \* ?/gm, "");

function fail(message: string, code = 2): never {
  console.log(JSON.stringify({ ok: false, error: message }));
  process.exit(code);
}

function parse(argv: string[]): Options {
  const o: Partial<Options> & { refs: string[] } = { refs: [], transparent: false, tries: 3, timeout: 600, meta: false, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${a} needs a value`);
      return v;
    };
    if (a === "--prompt") o.prompt = value();
    else if (a === "--prompt-file") o.prompt = readFileSync(value(), "utf8").trim();
    else if (a === "--out") o.out = resolve(value());
    else if (a === "--ref") o.refs.push(resolve(value()));
    else if (a === "--transparent") o.transparent = true;
    else if (a === "--tries") o.tries = Number(value());
    else if (a === "--timeout") o.timeout = Number(value());
    else if (a === "--model") o.model = value();
    else if (a === "--effort") o.effort = value();
    else if (a === "--meta") o.meta = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "-h" || a === "--help") {
      console.log(HELP);
      process.exit(0);
    } else fail(`unknown argument: ${a}`);
  }
  if (!o.prompt) fail("--prompt or --prompt-file is required");
  if (!o.out) fail("--out is required");
  if (extname(o.out).toLowerCase() !== ".png") fail("--out must end in .png");
  for (const r of o.refs) if (!existsSync(r)) fail(`reference image not found: ${r}`);
  if (!(o.tries >= 1) || !(o.timeout >= 30)) fail("--tries must be >= 1 and --timeout >= 30 (seconds)");
  return o as Options;
}

type PngInfo = { width: number; height: number; colorType: number; hasAlpha: boolean; bytes: number };

/** PNG signature and IHDR; alpha = colour type 4/6 or a tRNS chunk. Null if the file is not a PNG. */
function pngInfo(path: string): PngInfo | null {
  const b = readFileSync(path);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 33 || sig.some((v, i) => b[i] !== v) || b.toString("latin1", 12, 16) !== "IHDR") return null;
  const colorType = b[25];
  let hasAlpha = colorType === 4 || colorType === 6;
  for (let p = 8; p + 8 <= b.length && !hasAlpha; ) {
    const len = b.readUInt32BE(p);
    const type = b.toString("latin1", p + 4, p + 8);
    if (type === "tRNS") hasAlpha = true;
    if (type === "IDAT" || type === "IEND") break;
    p += 12 + len;
  }
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType, hasAlpha, bytes: b.length };
}

function message(o: Options, target: string): string {
  const refs =
    o.refs.length === 0 ? "" : o.refs.length === 1 ? " Use the attached image as the reference." : " Use the attached images as the references.";
  const alpha = o.transparent ? " Set transparent_background to true." : "";
  return (
    `Use your image generation tool to create exactly one image.${refs}${alpha} Pass the image prompt below to the tool ` +
    `unchanged. Then save the generated image as PNG to ${target} (copy the generated file there). ` +
    `Do nothing else. Reply with the path.\n\nImage prompt:\n${o.prompt}`
  );
}

/** Image the agent did not copy: look for paths under ~/.codex/generated_images in the JSONL events. */
function findGenerated(log: string): string | null {
  const root = join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "generated_images");
  const paths = [...log.matchAll(/[^"\s]*generated_images\/[^"\s]+?\.(?:png|jpe?g|webp)/g)].map((m) => m[0]);
  for (const p of paths.reverse()) if (existsSync(p)) return p;
  const id = log.match(/"(?:thread_id|session_id|conversation_id)"\s*:\s*"([0-9a-f-]{20,})"/)?.[1];
  if (id && existsSync(join(root, id))) {
    const files = readdirSync(join(root, id))
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .map((f) => join(root, id, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (files.length) return files[0];
  }
  return null;
}

const o = parse(Bun.argv.slice(2));
const work = mkdtempSync(join(tmpdir(), "codex-image-"));
const target = join(work, "image.png");
const args = ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check"];
if (o.model) args.push("-m", o.model);
if (o.effort) args.push("-c", `model_reasoning_effort=${o.effort}`);
for (const r of o.refs) args.push("--image", r);
args.push("--", message(o, target));

if (o.dryRun) {
  console.log(JSON.stringify({ dryRun: true, cwd: work, command: ["codex", ...args] }, null, 1));
  process.exit(0);
}

const attempts: { n: number; seconds: number; exit: number | string; error?: string }[] = [];
for (let n = 1; n <= o.tries; n++) {
  const t0 = Date.now();
  const r = spawnSync("codex", args, { cwd: work, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: o.timeout * 1000, maxBuffer: 64 << 20 });
  const seconds = Math.round((Date.now() - t0) / 1000);
  const log = `${r.stdout ?? ""}\n--- stderr ---\n${r.stderr ?? ""}`;
  const logPath = join(work, `attempt${n}.log`);
  writeFileSync(logPath, log);
  const exit = r.error ? (r.error as NodeJS.ErrnoException).code ?? String(r.error) : r.status ?? "signal";
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ENOENT") fail("codex CLI not found on PATH", 1);
  let file = existsSync(target) ? target : findGenerated(log);
  let error: string | undefined;
  const info = file ? pngInfo(file) : null;
  if (!file) error = "no image saved";
  else if (!info) error = `not a PNG: ${file}`;
  else if (o.transparent && !info.hasAlpha) error = "no alpha channel (asked for a transparent background)";
  attempts.push({ n, seconds, exit, ...(error ? { error } : {}) });
  if (!error && file && info) {
    mkdirSync(dirname(o.out), { recursive: true });
    copyFileSync(file, o.out);
    const result = {
      ok: true,
      out: o.out,
      width: info.width,
      height: info.height,
      alpha: info.hasAlpha,
      bytes: info.bytes,
      seconds,
      attempts: n,
      source: file === target ? "copied by codex" : `found in ${file}`,
    };
    if (o.meta) {
      writeFileSync(
        o.out.replace(/\.png$/i, ".json"),
        JSON.stringify({ ...result, prompt: o.prompt, refs: o.refs, transparent: o.transparent, model: o.model ?? "codex default",
          effort: o.effort ?? "codex default", created: new Date().toISOString(), tool: "codex exec image generation" }, null, 1) + "\n",
      );
    }
    console.log(JSON.stringify(result));
    process.exit(0);
  }
  if (n < o.tries) Bun.sleepSync(10_000 * n);
}
console.log(JSON.stringify({ ok: false, error: attempts.at(-1)?.error ?? "failed", attempts, logs: work }));
process.exit(1);
