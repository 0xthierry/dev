import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type AuditRecord, appendAudit } from "./audit";

const roots: string[] = [];
const record: AuditRecord = {
  timestamp: "2026-07-11T00:00:00.000Z",
  runId: "run",
  method: "type_text",
  app: "target-sha256:0123456789abcdef",
  inputBytes: 19,
  outcome: "ok",
  durationMs: 20,
  brokerVersion: "codex-cli 0.144.0-alpha.4",
  clientBuild: "1000366",
  directCalls: 1,
  modelTurnsStarted: 0,
  ephemeralThread: true,
  elicitationRequests: 0,
  brokerCleanupVerified: true,
  resultContentTypes: ["text"],
  resultBytes: 42,
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("appendAudit", () => {
  test("writes private metadata without arguments, output, or secrets", async () => {
    // Arrange
    const root = await mkdtemp(path.join(os.tmpdir(), "direct-audit-test."));
    roots.push(root);

    // Act
    await appendAudit(root, record);
    const auditPath = path.join(root, "audit", "direct-computer-use.jsonl");
    const text = await readFile(auditPath, "utf8");
    const parsed = JSON.parse(text.trim()) as Record<string, unknown>;

    // Assert
    expect((await stat(auditPath)).mode & 0o777).toBe(0o600);
    expect(parsed.method).toBe("type_text");
    for (const forbidden of ["arguments", "text", "value", "content", "token", "prompt", "modelUsage"]) {
      expect(Object.hasOwn(parsed, forbidden)).toBe(false);
    }
  });

  test("rejects a symlinked audit state directory", async () => {
    // Arrange
    const root = await mkdtemp(path.join(os.tmpdir(), "direct-audit-state-symlink-test."));
    roots.push(root);
    const outside = path.join(root, "outside.txt");
    await writeFile(outside, "untouched\n", { mode: 0o600 });
    await symlink(outside, path.join(root, "state-link"));

    // Act
    const execution = appendAudit(path.join(root, "state-link"), record);

    // Assert
    await expect(execution).rejects.toThrow("non-symlink directory");
    expect(await readFile(outside, "utf8")).toBe("untouched\n");
  });

  test("rejects a symlinked audit log target", async () => {
    // Arrange
    const root = await mkdtemp(path.join(os.tmpdir(), "direct-audit-log-symlink-test."));
    roots.push(root);
    const outside = path.join(root, "outside.txt");
    await writeFile(outside, "untouched\n", { mode: 0o600 });
    const state = path.join(root, "state");
    await appendAudit(state, { ...record, runId: "seed" });
    const log = path.join(state, "audit", "direct-computer-use.jsonl");
    await rm(log);
    await symlink(outside, log);

    // Act
    const execution = appendAudit(state, record);

    // Assert
    await expect(execution).rejects.toThrow();
    expect(await readFile(outside, "utf8")).toBe("untouched\n");
  });
});
