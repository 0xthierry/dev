#!/usr/bin/env bun
// Merge repo-owned UI preferences without replacing unrelated Claude state.
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

function parseObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Claude preferences and state must be JSON objects");
  }
  return value as Record<string, unknown>;
}

const target = process.argv[2] ?? join(homedir(), ".claude.json");
const preferences = parseObject(
  await readFile(new URL("./claude-preferences.json", import.meta.url), "utf8"),
);
const info = await lstat(target).catch((error: NodeJS.ErrnoException) => {
  if (error.code === "ENOENT") return undefined;
  throw error;
});
if (info?.isSymbolicLink()) throw new Error("Refusing to replace symlinked Claude state");
const current = info ? parseObject(await readFile(target, "utf8")) : {};
const desired = { ...current, ...preferences };
if (JSON.stringify(desired) !== JSON.stringify(current)) {
  await mkdir(dirname(target), { recursive: true });
  const temporary = join(dirname(target), `.claude-preferences-${crypto.randomUUID()}`);
  await writeFile(temporary, `${JSON.stringify(desired, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  });
  try {
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}
console.log("Claude auto-compaction enabled; unrelated state preserved.");
