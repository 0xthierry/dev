import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFakePi } from "../_shared/testing/fake-pi";
import registerExtension from "./index";

const originalMultiAuthDir = process.env.CODEX_MULTI_AUTH_DIR;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  if (originalMultiAuthDir === undefined) delete process.env.CODEX_MULTI_AUTH_DIR;
  else process.env.CODEX_MULTI_AUTH_DIR = originalMultiAuthDir;
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("codex-multi-auth extension entrypoint", () => {
  test("keeps native Codex auth when no multi-account storage exists", async () => {
    // Arrange
    const storage = await mkdtemp(join(tmpdir(), "pi-codex-multi-auth-empty-"));
    temporaryDirectories.push(storage);
    process.env.CODEX_MULTI_AUTH_DIR = storage;
    const fakePi = createFakePi();

    // Act
    await registerExtension(fakePi.pi);

    // Assert
    expect(fakePi.providers.size).toBe(0);
  });
});
