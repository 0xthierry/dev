import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArtifactTooLargeError,
  isArtifactVisibleToCaller,
  MAX_ARTIFACT_BYTES,
  MAX_ARTIFACT_METADATA_BYTES,
  MAX_ARTIFACT_PAGE_BYTES,
  MAX_MODEL_ARTIFACT_SOURCE_BYTES,
  readArtifact,
  readArtifactMetadata,
  readArtifactPage,
  readAuthorizedArtifactPage,
  writeArtifact,
} from "./artifacts";

describe("artifact storage", () => {
  test("durably stores full output behind a stable opaque reference", async () => {
    // Arrange
    const agentDir = await mkdtemp(join(tmpdir(), "subagent-artifacts-"));
    const content = `HEAD-SENTINEL-FOR-RETRIEVAL\n${"detail".repeat(10_000)}`;

    try {
      // Act
      const stored = await writeArtifact({
        cwd: "/repo",
        agentPath: "/root/review",
        agentId: "agent-1",
        kind: "completion",
        content,
        agentDir,
      });
      const first = await readArtifactPage(stored.reference, "/repo", { maxBytes: 16 * 1024 }, agentDir);
      const second =
        first.ok && first.page.nextCursor !== undefined
          ? await readArtifactPage(stored.reference, "/repo", { cursor: first.page.nextCursor }, agentDir)
          : undefined;

      // Assert
      expect(stored.reference).toMatch(/^subagent-artifact:[0-9a-f]{32}$/);
      expect(stored.reference).not.toContain(agentDir);
      expect(first).toMatchObject({ ok: true, page: { cursor: 0, eof: false } });
      expect(first.ok ? first.page.content : "").toContain("HEAD-SENTINEL-FOR-RETRIEVAL");
      expect(second).toMatchObject({ ok: true, page: { cursor: expect.any(Number) } });
      expect(stored.bytes).toBe(Buffer.byteLength(content));
      expect(stored.lines).toBe(2);
      expect((await stat(stored.path)).mode & 0o777).toBe(0o600);
      expect((await stat(join(stored.path, ".."))).mode & 0o777).toBe(0o700);
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  test("allocates unique private paths and writes metadata without output or credentials", async () => {
    // Arrange
    const agentDir = await mkdtemp(join(tmpdir(), "subagent-artifacts-"));
    const input = {
      cwd: "/repo",
      agentPath: "/root/worker",
      agentId: "agent-2",
      kind: "failure" as const,
      content: "provider failed with private details",
      agentDir,
    };

    try {
      // Act
      const first = await writeArtifact(input);
      const second = await writeArtifact(input);
      const metadata = await readFile(first.metadataPath, "utf8");

      // Assert
      expect(first.path).not.toBe(second.path);
      expect(first.reference).not.toBe(second.reference);
      expect(metadata).toContain('"kind": "failure"');
      expect(metadata).not.toContain(input.content);
      expect(metadata).not.toMatch(/authorization|token|headers|prompt|environment/i);
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  test("enforces the 2 MiB full-artifact hard cap at max and max plus one", async () => {
    // Arrange
    const agentDir = await mkdtemp(join(tmpdir(), "subagent-artifacts-"));
    const input = {
      cwd: "/repo",
      agentPath: "/root/worker",
      agentId: "agent-cap",
      kind: "completion" as const,
      agentDir,
    };

    try {
      // Act
      const maximum = await writeArtifact({ ...input, content: "x".repeat(MAX_ARTIFACT_BYTES) });
      const oversized = writeArtifact({ ...input, content: "x".repeat(MAX_ARTIFACT_BYTES + 1) });

      // Assert
      expect(maximum.bytes).toBe(MAX_ARTIFACT_BYTES);
      await expect(oversized).rejects.toBeInstanceOf(ArtifactTooLargeError);
      await expect(oversized).rejects.toMatchObject({ kind: "artifact_too_large", bytes: MAX_ARTIFACT_BYTES + 1 });
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  test("returns UTF-8 aligned byte cursors and rejects arbitrary offsets", async () => {
    // Arrange
    const agentDir = await mkdtemp(join(tmpdir(), "subagent-artifacts-"));

    try {
      const stored = await writeArtifact({
        cwd: "/repo",
        agentPath: "/root/worker",
        agentId: "agent-utf8",
        kind: "completion",
        content: "éclair\nsecond line\nthird line",
        agentDir,
      });

      // Act
      const first = await readArtifactPage(stored.reference, "/repo", { maxBytes: 7, maxLines: 1 }, agentDir);
      const invalid = await readArtifactPage(stored.reference, "/repo", { cursor: 1 }, agentDir);

      // Assert
      expect(first).toMatchObject({ ok: true, page: { content: "éclair", bytes: 7, nextCursor: 7 } });
      expect(invalid).toEqual({ ok: false, reason: "invalid-cursor" });
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  test("reconstructs pathological content through envelope-safe authorized pages", async () => {
    // Arrange
    const agentDir = await mkdtemp(join(tmpdir(), "subagent-artifacts-"));
    const content = '\0\n"\\é'.repeat(8_000);

    try {
      const stored = await writeArtifact({
        cwd: "/repo",
        agentPath: "/root/worker",
        agentId: "agent-pathological",
        kind: "completion",
        content,
        agentDir,
      });

      // Act
      let cursor = 0;
      let reconstructed = "";
      let eof = false;
      while (!eof) {
        const result = await readAuthorizedArtifactPage(
          stored.reference,
          "/repo",
          "/root",
          { cursor, maxBytes: MAX_ARTIFACT_PAGE_BYTES, maxLines: 200 },
          agentDir,
        );
        if (!result.ok) throw new Error(result.reason);
        reconstructed += result.page.content;
        expect(result.page.bytes).toBeLessThanOrEqual(MAX_MODEL_ARTIFACT_SOURCE_BYTES);
        eof = result.page.eof;
        cursor = result.page.eof ? result.page.cursor + result.page.bytes : (result.page.nextCursor as number);
      }

      // Assert
      expect(reconstructed).toBe(content);
      expect(cursor).toBe(stored.bytes);
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  test("reads bounded validated ownership metadata and authorizes only the direct parent", async () => {
    // Arrange
    const agentDir = await mkdtemp(join(tmpdir(), "subagent-artifacts-"));

    try {
      const stored = await writeArtifact({
        cwd: "/repo",
        agentPath: "/root/coordinator/leaf",
        agentId: "leaf-id",
        kind: "completion",
        content: "leaf output",
        agentDir,
      });

      // Act
      const result = await readArtifactMetadata(stored.reference, "/repo", agentDir);
      const visibility = result.ok
        ? [
            isArtifactVisibleToCaller(result.metadata, "/root/coordinator"),
            isArtifactVisibleToCaller(result.metadata, "/root/sibling"),
            isArtifactVisibleToCaller(result.metadata, "/root/coordinator/leaf"),
          ]
        : [];

      // Assert
      expect(result).toMatchObject({
        ok: true,
        metadata: { agentPath: "/root/coordinator/leaf", agentId: "leaf-id", kind: "completion" },
      });
      expect(visibility).toEqual([true, false, false]);
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  test("denies root descendant and direct-child handoff artifacts without an authorization oracle", async () => {
    // Arrange
    const agentDir = await mkdtemp(join(tmpdir(), "subagent-artifacts-"));

    try {
      const descendant = await writeArtifact({
        cwd: "/repo",
        agentPath: "/root/coordinator/leaf",
        agentId: "leaf",
        kind: "completion",
        content: "descendant",
        agentDir,
      });
      const handoff = await writeArtifact({
        cwd: "/repo",
        agentPath: "/root/coordinator",
        agentId: "coordinator",
        kind: "handoff",
        content: "private mail",
        agentDir,
      });

      // Act
      const descendantResult = await readAuthorizedArtifactPage(descendant.reference, "/repo", "/root", {}, agentDir);
      const handoffResult = await readAuthorizedArtifactPage(handoff.reference, "/repo", "/root", {}, agentDir);

      // Assert
      expect(descendantResult).toEqual({ ok: false, reason: "not-found" });
      expect(handoffResult).toEqual({ ok: false, reason: "not-found" });
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  test("rejects metadata-output size swaps on the authorized path", async () => {
    // Arrange
    const agentDir = await mkdtemp(join(tmpdir(), "subagent-artifacts-"));

    try {
      const stored = await writeArtifact({
        cwd: "/repo",
        agentPath: "/root/worker",
        agentId: "worker",
        kind: "completion",
        content: "original",
        agentDir,
      });
      await writeFile(stored.path, "replacement-with-different-size");

      // Act
      const result = await readAuthorizedArtifactPage(stored.reference, "/repo", "/root", {}, agentDir);

      // Assert
      expect(result).toEqual({ ok: false, reason: "unavailable" });
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  test("rejects metadata above its decode cap without parsing it", async () => {
    // Arrange
    const agentDir = await mkdtemp(join(tmpdir(), "subagent-artifacts-"));

    try {
      const stored = await writeArtifact({
        cwd: "/repo",
        agentPath: "/root/worker",
        agentId: "agent-metadata",
        kind: "completion",
        content: "output",
        agentDir,
      });
      await writeFile(stored.metadataPath, "x".repeat(MAX_ARTIFACT_METADATA_BYTES + 1));

      // Act
      const result = await readArtifactMetadata(stored.reference, "/repo", agentDir);

      // Assert
      expect(result).toEqual({ ok: false, reason: "invalid-metadata" });
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  test("returns typed lookup failures", async () => {
    // Arrange
    const agentDir = await mkdtemp(join(tmpdir(), "subagent-artifacts-"));

    try {
      // Act
      const invalid = await readArtifact("../secret", "/repo", agentDir);
      const missing = await readArtifact("subagent-artifact:0123456789abcdef0123456789abcdef", "/repo", agentDir);

      // Assert
      expect(invalid).toEqual({ ok: false, reason: "invalid-reference" });
      expect(missing).toEqual({ ok: false, reason: "not-found" });
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });
});
