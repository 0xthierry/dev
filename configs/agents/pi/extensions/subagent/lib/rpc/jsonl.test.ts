import { describe, expect, test } from "bun:test";
import {
  encodeJsonl,
  JsonlCommandTooLargeError,
  JsonlDecoder,
  JsonlProtocolError,
  JsonlRecordTooLargeError,
  MAX_INBOUND_JSONL_RECORD_BYTES,
  MAX_OUTBOUND_JSONL_BYTES,
} from "./jsonl";

describe("JsonlDecoder", () => {
  test("decodes UTF-8 split across chunks and LF-framed records", () => {
    // Arrange
    const decoder = new JsonlDecoder();
    const bytes = Buffer.from('{"text":"héllo"}\n{"value":2}\n');
    const split = bytes.indexOf(0xc3) + 1;

    // Act
    const first = decoder.write(bytes.subarray(0, split));
    const second = decoder.write(bytes.subarray(split));
    const final = decoder.end();

    // Assert
    expect(first).toEqual([]);
    expect(second).toEqual([{ text: "héllo" }, { value: 2 }]);
    expect(final).toEqual([]);
  });

  test("accepts CRLF while preserving Unicode line separators inside JSON strings", () => {
    // Arrange
    const decoder = new JsonlDecoder();

    // Act
    const records = decoder.write('{"text":"left right end"}\r\n');

    // Assert
    expect(records).toEqual([{ text: "left right end" }]);
  });

  test("decodes one final unterminated record when the stream ends", () => {
    // Arrange
    const decoder = new JsonlDecoder();
    decoder.write('{"done":');

    // Act
    const records = decoder.end("true}");

    // Assert
    expect(records).toEqual([{ done: true }]);
  });

  test("rejects blank records and non-object JSON", () => {
    // Arrange
    const blankDecoder = new JsonlDecoder();
    const arrayDecoder = new JsonlDecoder();

    // Act / Assert
    expect(() => blankDecoder.write("\n")).toThrow(JsonlProtocolError);
    expect(() => arrayDecoder.write("[]\n")).toThrow("record must be a JSON object");
  });

  test("accepts the 16 MiB record maximum and rejects max plus one across split chunks before append", () => {
    // Arrange
    const overhead = Buffer.byteLength('{"text":""}', "utf8");
    const atMaximum = `{"text":"${"x".repeat(MAX_INBOUND_JSONL_RECORD_BYTES - overhead)}"}`;
    const oversized = `${atMaximum.slice(0, -1)}x}`;
    const accepted = new JsonlDecoder();
    const rejected = new JsonlDecoder();

    // Act
    const records = accepted.write(`${atMaximum}\n`);
    rejected.write(oversized.slice(0, -1));

    // Assert
    expect(records).toHaveLength(1);
    expect(() => rejected.write("}\n")).toThrow(JsonlRecordTooLargeError);
  });

  test("redacts known secrets from bounded malformed-record previews", () => {
    // Arrange
    const secret = "provider-token-sentinel-123";
    const decoder = new JsonlDecoder({ redact: (value) => value.replaceAll(secret, "[REDACTED]") });

    // Act
    let message = "";
    try {
      decoder.write(`{"value":"${secret}" trailing\n`);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    // Assert
    expect(message).toContain("[REDACTED]");
    expect(message).not.toContain(secret);
  });

  test("reports a bounded malformed-record preview", () => {
    // Arrange
    const decoder = new JsonlDecoder();
    const malformed = `{"secret":"${"x".repeat(1_000)}"\n`;

    // Act
    let error: unknown;
    try {
      decoder.write(malformed);
    } catch (caught) {
      error = caught;
    }

    // Assert
    expect(error).toBeInstanceOf(JsonlProtocolError);
    expect((error as Error).message.length).toBeLessThan(500);
    expect((error as Error).message).toContain("line 1");
  });
});

describe("encodeJsonl", () => {
  test("accepts an encoded command at 2 MiB and rejects max plus one", () => {
    // Arrange
    const overhead = Buffer.byteLength('{"text":""}\n', "utf8");
    const exact = { text: "x".repeat(MAX_OUTBOUND_JSONL_BYTES - overhead) };
    const oversized = { text: `${exact.text}x` };

    // Act
    const encoded = encodeJsonl(exact);

    // Assert
    expect(Buffer.byteLength(encoded)).toBe(MAX_OUTBOUND_JSONL_BYTES);
    expect(() => encodeJsonl(oversized)).toThrow(JsonlCommandTooLargeError);
  });

  test("carries a raw prompt above the retired policy cap under worst-case JSON escaping", () => {
    // Arrange
    const prompt = "\0".repeat(300 * 1024);

    // Act
    const encoded = encodeJsonl({ type: "prompt", id: "max-prompt", message: prompt });

    // Assert
    expect(Buffer.byteLength(encoded, "utf8")).toBeLessThanOrEqual(MAX_OUTBOUND_JSONL_BYTES);
    expect((JSON.parse(encoded) as { message: string }).message).toBe(prompt);
  });

  test("writes exactly one LF-terminated JSON object", () => {
    // Arrange
    const value = { type: "get_state", text: "line separator" };

    // Act
    const encoded = encodeJsonl(value);

    // Assert
    expect(encoded).toBe('{"type":"get_state","text":"line separator"}\n');
  });
});
