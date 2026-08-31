import { StringDecoder } from "node:string_decoder";
import type { RedactText } from "../security/redaction";

export type JsonObject = Record<string, unknown>;

export const MAX_RPC_ERROR_PREVIEW_CHARS = 256;
/** One inbound JSONL record may be at most 16 MiB before LF, bounding split-chunk accumulation. */
export const MAX_INBOUND_JSONL_RECORD_BYTES = 16 * 1024 * 1024;
/** One encoded command may be at most 2 MiB including LF; raw assignment size varies with JSON escaping. */
export const MAX_OUTBOUND_JSONL_BYTES = 2 * 1024 * 1024;
const identity: RedactText = (value) => value;

export class JsonlProtocolError extends Error {
  readonly lineNumber: number;

  constructor(message: string, lineNumber: number, line?: string, redact: RedactText = identity) {
    const preview = line === undefined ? "" : `: ${boundedPreview(redact(line))}`;
    super(`Invalid RPC JSONL at line ${lineNumber}: ${message}${preview}`);
    this.name = "JsonlProtocolError";
    this.lineNumber = lineNumber;
  }
}

export class JsonlRecordTooLargeError extends Error {
  readonly kind = "rpc_record_too_large";

  constructor(readonly maxBytes: number) {
    super(`RPC JSONL record exceeds the ${maxBytes}-byte hard cap`);
    this.name = "JsonlRecordTooLargeError";
  }
}

export class JsonlCommandTooLargeError extends Error {
  readonly kind = "rpc_command_too_large";

  constructor(readonly bytes: number) {
    super(`Encoded RPC command exceeds the ${MAX_OUTBOUND_JSONL_BYTES}-byte hard cap`);
    this.name = "JsonlCommandTooLargeError";
  }
}

export interface JsonlDecoderOptions {
  maxRecordBytes?: number;
  redact?: RedactText;
}

/**
 * Incrementally decodes strict LF-delimited JSON records. The raw byte counter
 * is checked before StringDecoder/string append, including split UTF-8 pending bytes.
 */
export class JsonlDecoder {
  private readonly decoder = new StringDecoder("utf8");
  private readonly maxRecordBytes: number;
  private readonly redact: RedactText;
  private buffer = "";
  private lineNumber = 0;
  private currentRecordBytes = 0;
  private ended = false;

  constructor(options: JsonlDecoderOptions = {}) {
    this.maxRecordBytes = options.maxRecordBytes ?? MAX_INBOUND_JSONL_RECORD_BYTES;
    this.redact = options.redact ?? identity;
    if (!Number.isInteger(this.maxRecordBytes) || this.maxRecordBytes < 1) {
      throw new RangeError("RPC JSONL record limit must be a positive integer");
    }
  }

  write(chunk: Uint8Array | string): JsonObject[] {
    if (this.ended) throw new Error("Cannot write to an ended JSONL decoder");
    const bytes = Buffer.from(chunk);
    this.accountBeforeAppend(bytes);
    this.buffer += this.decoder.write(bytes);
    return this.takeCompleteLines();
  }

  end(chunk?: Uint8Array | string): JsonObject[] {
    if (this.ended) return [];
    if (chunk !== undefined) {
      const bytes = Buffer.from(chunk);
      this.accountBeforeAppend(bytes);
      this.buffer += this.decoder.write(bytes);
    }
    this.buffer += this.decoder.end();
    this.ended = true;

    const records = this.takeCompleteLines();
    if (this.buffer.length > 0) {
      const finalLine = this.buffer.endsWith("\r") ? this.buffer.slice(0, -1) : this.buffer;
      this.buffer = "";
      records.push(this.parseLine(finalLine));
    }
    return records;
  }

  private accountBeforeAppend(bytes: Buffer): void {
    let recordBytes = this.currentRecordBytes;
    for (const byte of bytes) {
      if (byte === 0x0a) {
        recordBytes = 0;
        continue;
      }
      recordBytes += 1;
      if (recordBytes > this.maxRecordBytes) throw new JsonlRecordTooLargeError(this.maxRecordBytes);
    }
    this.currentRecordBytes = recordBytes;
  }

  private takeCompleteLines(): JsonObject[] {
    const records: JsonObject[] = [];
    while (true) {
      const newline = this.buffer.indexOf("\n");
      if (newline === -1) return records;

      let line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      records.push(this.parseLine(line));
    }
  }

  private parseLine(line: string): JsonObject {
    this.lineNumber += 1;
    if (line.length === 0) throw new JsonlProtocolError("empty records are not allowed", this.lineNumber);

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      const message = error instanceof Error ? error.message : "malformed JSON";
      throw new JsonlProtocolError(message, this.lineNumber, line, this.redact);
    }

    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new JsonlProtocolError("record must be a JSON object", this.lineNumber, line, this.redact);
    }
    return value as JsonObject;
  }
}

export function encodeJsonl(value: JsonObject): string {
  const encoded = `${JSON.stringify(value)}\n`;
  const bytes = Buffer.byteLength(encoded, "utf8");
  if (bytes > MAX_OUTBOUND_JSONL_BYTES) throw new JsonlCommandTooLargeError(bytes);
  return encoded;
}

function boundedPreview(line: string): string {
  const preview = line.slice(0, MAX_RPC_ERROR_PREVIEW_CHARS);
  return JSON.stringify(preview + (line.length > MAX_RPC_ERROR_PREVIEW_CHARS ? "…" : ""));
}
