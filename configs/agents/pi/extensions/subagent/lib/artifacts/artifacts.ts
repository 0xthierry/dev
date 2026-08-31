import { randomBytes } from "node:crypto";
import { type FileHandle, mkdir, open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  artifactIdFromReference,
  artifactReference,
  getPrivateArtifactDirectory,
  getProjectArtifactDirectory,
} from "../sessions/paths";

/** Full artifacts are capped at 2 MiB raw UTF-8 so their worst-case JSON envelope fits the 16 MiB RPC record cap. */
export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
/** Callers may request up to 32 KiB, while model-bound authorization returns a smaller envelope-safe page. */
export const MAX_ARTIFACT_PAGE_BYTES = 32 * 1024;
export const DEFAULT_ARTIFACT_PAGE_BYTES = 16 * 1024;
/**
 * A 3 KiB raw page stays below the 40 KiB model-result boundary after either
 * worst-case JSON escaping (6x) or one-pass exact redaction of a one-byte secret (10x).
 */
export const MAX_MODEL_ARTIFACT_SOURCE_BYTES = 3 * 1024;
/** Line limiting prevents one page from becoming an unbounded structured transcript. */
export const MAX_ARTIFACT_PAGE_LINES = 200;
export const DEFAULT_ARTIFACT_PAGE_LINES = 120;
/** Metadata is fixed-schema and capped before JSON decoding. */
export const MAX_ARTIFACT_METADATA_BYTES = 4 * 1024;
/** Cryptographic parameter: 128-bit opaque IDs, not a configurable resource limit. */
export const ARTIFACT_ID_BYTES = 16;
/** Collision robustness parameter, not a configurable resource limit. */
export const ARTIFACT_DIRECTORY_ALLOCATION_ATTEMPTS = 4;
const MAX_RECOVERY_ARTIFACT_BYTES = MAX_ARTIFACT_PAGE_BYTES;

export type ArtifactKind = "completion" | "failure" | "handoff";

export interface WriteArtifactInput {
  cwd: string;
  agentPath: string;
  agentId: string;
  kind: ArtifactKind;
  content: string;
  agentDir?: string;
}

export interface StoredArtifact {
  reference: string;
  path: string;
  metadataPath: string;
  bytes: number;
  lines: number;
}

export interface ReadArtifactPageOptions {
  cursor?: number;
  maxBytes?: number;
  maxLines?: number;
}

export interface ArtifactPage {
  reference: string;
  cursor: number;
  content: string;
  bytes: number;
  lines: number;
  eof: boolean;
  nextCursor?: number;
}

export type ArtifactReadFailureReason =
  | "invalid-reference"
  | "invalid-cursor"
  | "invalid-page-limit"
  | "invalid-utf8"
  | "not-found"
  | "artifact-too-large"
  | "unavailable";

export type ReadArtifactPageResult =
  | { ok: true; page: ArtifactPage }
  | { ok: false; reason: ArtifactReadFailureReason };

export type ReadArtifactResult = { ok: true; content: string } | { ok: false; reason: ArtifactReadFailureReason };

export interface ArtifactMetadata {
  version: 1;
  agentPath: string;
  agentId: string;
  kind: ArtifactKind;
  bytes: number;
  lines: number;
}

export type ReadArtifactMetadataResult =
  | { ok: true; metadata: ArtifactMetadata }
  | { ok: false; reason: ArtifactReadFailureReason | "invalid-metadata" };

export class ArtifactTooLargeError extends Error {
  readonly kind = "artifact_too_large";

  constructor(readonly bytes: number) {
    super(`Artifact exceeds the ${MAX_ARTIFACT_BYTES}-byte hard cap`);
    this.name = "ArtifactTooLargeError";
  }
}

export async function writeArtifact(input: WriteArtifactInput): Promise<StoredArtifact> {
  const bytes = Buffer.byteLength(input.content, "utf8");
  if (bytes > MAX_ARTIFACT_BYTES) throw new ArtifactTooLargeError(bytes);

  const projectDirectory = getProjectArtifactDirectory(input.cwd, input.agentDir);
  await mkdir(projectDirectory, { recursive: true, mode: 0o700 });

  const artifactId = await createPrivateDirectory(input.cwd, input.agentDir);
  const directory = getPrivateArtifactDirectory(input.cwd, artifactId, input.agentDir);
  const path = join(directory, "output.txt");
  const metadataPath = join(directory, "metadata.json");
  const lines = countLines(input.content);
  const metadata: ArtifactMetadata = {
    version: 1,
    agentPath: input.agentPath,
    agentId: input.agentId,
    kind: input.kind,
    bytes,
    lines,
  };

  await writeFile(path, input.content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });

  return { reference: artifactReference(artifactId), path, metadataPath, bytes, lines };
}

/**
 * Reads one bounded page by opaque reference. Cursors are UTF-8 byte offsets and
 * must land on a code-point boundary; the returned next cursor is always valid.
 */
export async function readArtifactPage(
  reference: string,
  cwd: string,
  options: ReadArtifactPageOptions = {},
  agentDir?: string,
  expectedBytes?: number,
): Promise<ReadArtifactPageResult> {
  const artifactId = artifactIdFromReference(reference);
  if (!artifactId) return { ok: false, reason: "invalid-reference" };
  const cursor = options.cursor ?? 0;
  const maxBytes = options.maxBytes ?? DEFAULT_ARTIFACT_PAGE_BYTES;
  const maxLines = options.maxLines ?? DEFAULT_ARTIFACT_PAGE_LINES;
  if (!Number.isInteger(cursor) || cursor < 0) return { ok: false, reason: "invalid-cursor" };
  if (!Number.isInteger(maxBytes) || maxBytes < 4 || maxBytes > MAX_ARTIFACT_PAGE_BYTES) {
    return { ok: false, reason: "invalid-page-limit" };
  }
  if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > MAX_ARTIFACT_PAGE_LINES) {
    return { ok: false, reason: "invalid-page-limit" };
  }

  let handle: FileHandle | undefined;
  try {
    handle = await open(join(getPrivateArtifactDirectory(cwd, artifactId, agentDir), "output.txt"), "r");
    const stats = await handle.stat();
    if (stats.size > MAX_ARTIFACT_BYTES) return { ok: false, reason: "artifact-too-large" };
    if (expectedBytes !== undefined && stats.size !== expectedBytes) return { ok: false, reason: "unavailable" };
    if (cursor > stats.size) return { ok: false, reason: "invalid-cursor" };
    if (cursor === stats.size) {
      return { ok: true, page: { reference, cursor, content: "", bytes: 0, lines: 0, eof: true } };
    }

    const buffer = Buffer.allocUnsafe(Math.min(maxBytes, stats.size - cursor));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, cursor);
    const available = buffer.subarray(0, bytesRead);
    if (isContinuationByte(available[0])) return { ok: false, reason: "invalid-cursor" };
    let end = validUtf8PrefixLength(available);
    if (end === 0) return { ok: false, reason: "invalid-utf8" };
    end = boundedLinePrefixLength(available.subarray(0, end), maxLines);
    const pageBytes = available.subarray(0, end);
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(pageBytes);
    } catch {
      return { ok: false, reason: "invalid-utf8" };
    }
    const nextCursor = cursor + end;
    const eof = nextCursor === stats.size;
    return {
      ok: true,
      page: {
        reference,
        cursor,
        content,
        bytes: end,
        lines: countPageLines(content),
        eof,
        ...(eof ? {} : { nextCursor }),
      },
    };
  } catch (error) {
    if (isMissing(error)) return { ok: false, reason: "not-found" };
    return { ok: false, reason: "unavailable" };
  } finally {
    await handle?.close();
  }
}

/** Recovery reads are bounded to small durable-mail artifacts and never use unbounded readFile. */
export async function readArtifact(reference: string, cwd: string, agentDir?: string): Promise<ReadArtifactResult> {
  const result = await readArtifactPage(
    reference,
    cwd,
    { maxBytes: MAX_RECOVERY_ARTIFACT_BYTES, maxLines: MAX_ARTIFACT_PAGE_LINES },
    agentDir,
  );
  if (!result.ok) return result;
  return result.page.eof ? { ok: true, content: result.page.content } : { ok: false, reason: "artifact-too-large" };
}

export async function readAuthorizedArtifactPage(
  reference: string,
  cwd: string,
  callerPath: string,
  options: ReadArtifactPageOptions = {},
  agentDir?: string,
): Promise<ReadArtifactPageResult> {
  const metadata = await readArtifactMetadata(reference, cwd, agentDir);
  if (!metadata.ok || !isArtifactVisibleToCaller(metadata.metadata, callerPath)) {
    return { ok: false, reason: "not-found" };
  }
  const result = await readArtifactPage(
    reference,
    cwd,
    {
      ...options,
      maxBytes: Math.min(options.maxBytes ?? DEFAULT_ARTIFACT_PAGE_BYTES, MAX_MODEL_ARTIFACT_SOURCE_BYTES),
    },
    agentDir,
    metadata.metadata.bytes,
  );
  if (!result.ok) return result;
  if (result.page.cursor + result.page.bytes > metadata.metadata.bytes) return { ok: false, reason: "unavailable" };
  if (result.page.eof !== (result.page.cursor + result.page.bytes === metadata.metadata.bytes)) {
    return { ok: false, reason: "unavailable" };
  }
  return result;
}

export async function readArtifactMetadata(
  reference: string,
  cwd: string,
  agentDir?: string,
): Promise<ReadArtifactMetadataResult> {
  const artifactId = artifactIdFromReference(reference);
  if (!artifactId) return { ok: false, reason: "invalid-reference" };
  let handle: FileHandle | undefined;
  try {
    handle = await open(join(getPrivateArtifactDirectory(cwd, artifactId, agentDir), "metadata.json"), "r");
    const stats = await handle.stat();
    if (stats.size > MAX_ARTIFACT_METADATA_BYTES) return { ok: false, reason: "invalid-metadata" };
    const buffer = Buffer.allocUnsafe(stats.size);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const metadata = parseArtifactMetadata(buffer.subarray(0, bytesRead).toString("utf8"));
    return metadata ? { ok: true, metadata } : { ok: false, reason: "invalid-metadata" };
  } catch (error) {
    if (isMissing(error)) return { ok: false, reason: "not-found" };
    return { ok: false, reason: "unavailable" };
  } finally {
    await handle?.close();
  }
}

export function isArtifactVisibleToCaller(metadata: ArtifactMetadata, callerPath: string): boolean {
  if (metadata.kind === "handoff") return false;
  const separator = metadata.agentPath.lastIndexOf("/");
  return separator > 0 && metadata.agentPath.slice(0, separator) === callerPath;
}

async function createPrivateDirectory(cwd: string, agentDir?: string): Promise<string> {
  for (let attempt = 0; attempt < ARTIFACT_DIRECTORY_ALLOCATION_ATTEMPTS; attempt += 1) {
    const artifactId = randomBytes(ARTIFACT_ID_BYTES).toString("hex");
    try {
      await mkdir(getPrivateArtifactDirectory(cwd, artifactId, agentDir), { mode: 0o700 });
      return artifactId;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
  }
  throw new Error("Could not allocate a unique artifact directory");
}

function parseArtifactMetadata(value: string): ArtifactMetadata | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  if (
    Object.keys(record).some((key) => !["version", "agentPath", "agentId", "kind", "bytes", "lines"].includes(key)) ||
    record.version !== 1 ||
    typeof record.agentPath !== "string" ||
    !/^\/root\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(record.agentPath) ||
    typeof record.agentId !== "string" ||
    !record.agentId.trim() ||
    record.agentId !== record.agentId.trim() ||
    (record.kind !== "completion" && record.kind !== "failure" && record.kind !== "handoff") ||
    !Number.isInteger(record.bytes) ||
    (record.bytes as number) < 0 ||
    (record.bytes as number) > MAX_ARTIFACT_BYTES ||
    !Number.isInteger(record.lines) ||
    (record.lines as number) < 0
  ) {
    return undefined;
  }
  return record as unknown as ArtifactMetadata;
}

function validUtf8PrefixLength(buffer: Buffer): number {
  const minimum = Math.max(0, buffer.length - 3);
  for (let end = buffer.length; end >= minimum; end -= 1) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, end));
      return end;
    } catch {
      // At most three trailing bytes can be an incomplete UTF-8 code point.
    }
  }
  return 0;
}

function boundedLinePrefixLength(buffer: Buffer, maxLines: number): number {
  let lines = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    const byte = buffer[index];
    if (byte === 0x0d) {
      lines += 1;
      if (lines === maxLines) return index + (buffer[index + 1] === 0x0a ? 2 : 1);
      continue;
    }
    if (byte !== 0x0a || buffer[index - 1] === 0x0d) continue;
    lines += 1;
    if (lines === maxLines) return index + 1;
  }
  return buffer.length;
}

function isContinuationByte(value: number | undefined): boolean {
  return value !== undefined && (value & 0xc0) === 0x80;
}

function countLines(content: string): number {
  if (!content) return 0;
  return content.split(/\r\n|\r|\n/).length;
}

function countPageLines(content: string): number {
  if (!content) return 0;
  const terminators = content.match(/\r\n|\r|\n/g)?.length ?? 0;
  return terminators + (/\r$|\n$/.test(content) ? 0 : 1);
}

function isMissing(error: unknown): boolean {
  return errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR";
}

function isAlreadyExists(error: unknown): boolean {
  return errorCode(error) === "EEXIST";
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
}
