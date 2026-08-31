import { describe, expect, test } from "bun:test";
import {
  AGGREGATE_PREVIEW_MAX_BYTES,
  AGGREGATE_PREVIEW_MAX_LINES,
  COMPLETION_PREVIEW_MAX_BYTES,
  prepareAggregatePreview,
  prepareArtifactPageForModel,
  prepareCompletionPreview,
  textFromContentParts,
} from "./output";

describe("prepareCompletionPreview", () => {
  test("keeps short output and includes its stable durable reference", () => {
    // Arrange
    const content = "Review complete.";
    const reference = "subagent-artifact:0123456789abcdef0123456789abcdef";

    // Act
    const preview = prepareCompletionPreview(content, reference);

    // Assert
    expect(preview).toEqual({ text: `${content}\n\n[Full output: ${reference}]`, truncated: false });
  });

  test("retains the completion tail within the hard 12 KiB cap", () => {
    // Arrange
    const tail = "important final result";
    const content = `${"x".repeat(COMPLETION_PREVIEW_MAX_BYTES * 2)}${tail}`;
    const reference = "subagent-artifact:0123456789abcdef0123456789abcdef";

    // Act
    const preview = prepareCompletionPreview(content, reference);

    // Assert
    expect(preview.truncated).toBe(true);
    expect(Buffer.byteLength(preview.text)).toBeLessThanOrEqual(COMPLETION_PREVIEW_MAX_BYTES);
    expect(preview.text).toContain(tail);
    expect(preview.text).toContain(reference);
  });
});

describe("prepareAggregatePreview", () => {
  test("keeps short aggregate output unchanged", () => {
    // Arrange
    const content = "Two agents completed.";

    // Act
    const preview = prepareAggregatePreview(content);

    // Assert
    expect(preview).toEqual({ text: content, truncated: false });
  });

  test("enforces both the 40 KiB and 360-line aggregate caps", () => {
    // Arrange
    const content = Array.from(
      { length: AGGREGATE_PREVIEW_MAX_LINES + 100 },
      (_, index) => `${"x".repeat(200)} line-${index}`,
    ).join("\n");

    // Act
    const preview = prepareAggregatePreview(content);

    // Assert
    expect(preview.truncated).toBe(true);
    expect(Buffer.byteLength(preview.text)).toBeLessThanOrEqual(AGGREGATE_PREVIEW_MAX_BYTES);
    expect(preview.text.split("\n").length).toBeLessThanOrEqual(AGGREGATE_PREVIEW_MAX_LINES);
    expect(preview.text).toContain(`line-${AGGREGATE_PREVIEW_MAX_LINES + 99}`);
    expect(preview.text).toContain("Aggregate preview truncated");
  });
});

describe("prepareArtifactPageForModel", () => {
  test("reduces a worst-case escaped page without advancing over omitted source bytes", () => {
    // Arrange
    const content = "\0".repeat(32 * 1024);
    const page = {
      reference: "subagent-artifact:0123456789abcdef0123456789abcdef",
      cursor: 100,
      content,
      bytes: Buffer.byteLength(content),
      lines: 1,
      eof: true,
    };

    // Act
    const prepared = prepareArtifactPageForModel(page);

    // Assert
    expect(Buffer.byteLength(prepared.text)).toBeLessThanOrEqual(AGGREGATE_PREVIEW_MAX_BYTES);
    expect(prepared.page.bytes).toBe(Buffer.byteLength(prepared.page.content));
    expect(prepared.page.nextCursor).toBe(page.cursor + prepared.page.bytes);
    expect(prepared.page.nextCursor).toBeLessThan(page.cursor + page.bytes);
    expect(prepared.page.eof).toBe(false);
    expect(prepared.text).not.toContain("Aggregate preview truncated");
  });
});

describe("textFromContentParts", () => {
  test("joins only assistant text parts", () => {
    // Arrange
    const content = [
      { type: "text", text: "first" },
      { type: "thinking", thinking: "private" },
      { type: "text", text: "second" },
    ];

    // Act
    const text = textFromContentParts(content);

    // Assert
    expect(text).toBe("first\nsecond");
  });
});
