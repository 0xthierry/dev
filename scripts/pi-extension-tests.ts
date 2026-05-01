#!/usr/bin/env bun

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const EXTENSIONS_DIR = "configs/agents/pi/extensions";

const usage = `Usage:
  bun scripts/pi-extension-tests.ts test [extension-name]
  bun scripts/pi-extension-tests.ts e2e [extension-name]

Examples:
  bun run test:pi-extensions
  bun run test:pi-extensions my-extension
  bun run test:pi-extensions:e2e
  bun run test:pi-extensions:e2e my-extension
`;

const mode = process.argv[2];
const extensionName = process.argv[3];

if (mode !== "test" && mode !== "e2e") {
  console.error(usage);
  process.exit(2);
}

if (process.argv.length > 4) {
  console.error(`Unexpected extra arguments: ${process.argv.slice(4).join(" ")}\n`);
  console.error(usage);
  process.exit(2);
}

const testRoot = extensionName ? join(EXTENSIONS_DIR, extensionName) : EXTENSIONS_DIR;

if (!existsSync(testRoot)) {
  console.error(`Extension test path does not exist: ${testRoot}`);
  process.exit(1);
}

const suffix = mode === "test" ? ".test.ts" : ".spec.ts";
const files = await findTests(testRoot, suffix);

if (files.length === 0) {
  console.log(`No ${suffix} files found under ${testRoot}.`);
  process.exit(0);
}

console.log(`Running ${files.length} Pi extension ${mode === "test" ? "test" : "E2E spec"} file(s).`);

const child = Bun.spawn(["bun", "test", ...files], {
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

const exitCode = await child.exited;
process.exit(exitCode);

async function findTests(root: string, suffix: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;

      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(suffix)) {
        results.push(path);
      }
    }
  }

  await walk(root);
  return results.sort();
}
