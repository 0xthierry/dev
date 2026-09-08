import { describe, expect, test } from "bun:test";
import { createTurnMetadata, parseBrowserUseToolResult } from "./result";

describe("parseBrowserUseToolResult", () => {
  test("joins text content blocks", () => {
    // Arrange
    const value = {
      content: [
        { type: "text", text: "one" },
        { type: "text", text: "two" },
      ],
      isError: false,
    } as const;

    // Act
    const result = parseBrowserUseToolResult(value);

    // Assert
    expect(result).toEqual({ content: [...value.content], text: "one\ntwo", isError: false });
  });

  test("marks kernel errors", () => {
    // Arrange
    const value = { content: [{ type: "text" as const, text: "nope" }], isError: true };

    // Act
    const result = parseBrowserUseToolResult(value);

    // Assert
    expect(result).toEqual({ content: value.content, text: "nope", isError: true });
  });

  test("accepts an empty result for JavaScript without output or turn end", () => {
    // Arrange
    const value = { content: [] };

    // Act
    const result = parseBrowserUseToolResult(value);

    // Assert
    expect(result).toEqual({ content: [], text: "", isError: false });
  });

  test("adds safe text for an empty kernel error", () => {
    // Arrange
    const value = { content: [], isError: true };

    // Act
    const result = parseBrowserUseToolResult(value);

    // Assert
    expect(result).toEqual({
      content: [{ type: "text", text: "Browser kernel returned an error with no text." }],
      text: "Browser kernel returned an error with no text.",
      isError: true,
    });
  });

  test("preserves image-only output without fabricating text", () => {
    // Arrange
    const image = { type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" };

    // Act
    const result = parseBrowserUseToolResult({ content: [image] });

    // Assert
    expect(result).toEqual({ content: [image], text: "", isError: false });
  });

  test("preserves mixed text and images in order and strips MCP-only metadata", () => {
    // Arrange
    const text = { type: "text" as const, text: "Screenshot:" };
    const image = { type: "image" as const, data: "aGVsbG8=", mimeType: "image/jpeg" };
    const value = {
      content: [text, { ...image, annotations: { audience: ["assistant"] } }, { type: "text", text: "Done" }],
    };

    // Act
    const result = parseBrowserUseToolResult(value);

    // Assert
    expect(result).toEqual({
      content: [text, image, { type: "text", text: "Done" }],
      text: "Screenshot:\nDone",
      isError: false,
    });
  });

  test("retains supported content alongside unsupported MCP blocks", () => {
    // Arrange
    const text = { type: "text" as const, text: "Found page" };
    const value = { content: [{ type: "resource_link", uri: "https://example.com" }, text] };

    // Act
    const result = parseBrowserUseToolResult(value);

    // Assert
    expect(result).toEqual({ content: [text], text: text.text, isError: false });
  });

  test.each(
    [
      null,
      undefined,
      "secret-payload",
      [],
      {},
      { content: null },
      { content: "secret-payload" },
      { content: {} },
      { content: [{ type: "resource", resource: { text: "secret-payload" } }] },
      { content: [{ type: "text", text: "secret-payload" }], isError: "false" },
      { content: [null] },
      { content: [[]] },
      { content: [{ text: "secret-payload" }] },
      { content: [{ type: "text", text: 42 }] },
      { content: [{ type: "image", data: "aGVsbG8=" }] },
      { content: [{ type: "image", data: "", mimeType: "image/png" }] },
      { content: [{ type: "image", data: "secret-payload", mimeType: "image/png" }] },
      { content: [{ type: "image", data: "aGVsbG8=", mimeType: "text/plain" }] },
      { content: [{ type: "image", data: 42, mimeType: "image/png" }] },
      { content: [{ type: "image", data: "aGVsbG8=", mimeType: null }] },
    ].map((value) => ({ value })),
  )("rejects malformed and unsupported-only results safely (%#)", ({ value }) => {
    // Arrange
    const errorText = "Browser kernel returned a malformed or unsupported result.";

    // Act
    const result = parseBrowserUseToolResult(value);

    // Assert
    expect(result).toEqual({ content: [{ type: "text", text: errorText }], text: errorText, isError: true });
    expect(JSON.stringify(result)).not.toContain("secret-payload");
  });

  test("does not report partial success when a mixed result has malformed content", () => {
    // Arrange
    const value = {
      content: [
        { type: "text", text: "secret-payload" },
        { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
        { type: "text", text: null },
      ],
    };

    // Act
    const result = parseBrowserUseToolResult(value);

    // Assert
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: result.text }]);
    expect(JSON.stringify(result)).not.toContain("secret-payload");
  });

  test("keeps images and adds a diagnostic for kernel errors without text", () => {
    // Arrange
    const image = { type: "image" as const, data: "aGVsbG8=", mimeType: "image/png" };

    // Act
    const result = parseBrowserUseToolResult({ content: [image], isError: true });

    // Assert
    expect(result).toEqual({
      content: [image, { type: "text", text: "Browser kernel returned an error with no text." }],
      text: "Browser kernel returned an error with no text.",
      isError: true,
    });
  });
});

describe("createTurnMetadata", () => {
  test("includes session and turn ids", () => {
    // Arrange
    const sessionId = "session-1";
    const turnId = "turn-1";

    // Act
    const result = createTurnMetadata(sessionId, turnId);

    // Assert
    expect(result).toMatchObject({
      threadId: "session-1",
      "x-codex-turn-metadata": {
        session_id: "session-1",
        turn_id: "turn-1",
        thread_id: "session-1",
      },
    });
  });
});
