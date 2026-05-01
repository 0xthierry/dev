import { describe, expect, test } from "bun:test";
import {
  buildDownloadImageScript,
  buildPollAssetsScript,
  buildSubmitPromptScript,
  detectChatGptImageType,
  parseAgentBrowserJsonOutput,
} from "./agent-browser-protocol";

describe("parseAgentBrowserJsonOutput", () => {
  test("parses agent-browser stringified eval output", () => {
    // Arrange
    const output = JSON.stringify(JSON.stringify({ ok: true, value: 1 }));

    // Act
    const result = parseAgentBrowserJsonOutput<{ ok: boolean; value: number }>(output);

    // Assert
    expect(result).toEqual({ ok: true, value: 1 });
  });

  test("parses plain JSON output", () => {
    // Arrange
    const output = JSON.stringify({ ok: true, value: 2 });

    // Act
    const result = parseAgentBrowserJsonOutput<{ ok: boolean; value: number }>(output);

    // Assert
    expect(result).toEqual({ ok: true, value: 2 });
  });
});

describe("ChatGPT browser scripts", () => {
  test("embeds prompt safely in the submit script", () => {
    // Arrange
    const prompt = 'generate a "fox" icon';

    // Act
    const script = buildSubmitPromptScript(prompt);

    // Assert
    expect(script).toContain(JSON.stringify(prompt));
    expect(script).toContain("#prompt-textarea");
    expect(script).toContain("document.execCommand");
  });

  test("poll script reads conversation assets", () => {
    // Arrange / Act
    const script = buildPollAssetsScript();

    // Assert
    expect(script).toContain("/backend-api/conversation/");
    expect(script).toContain("image_asset_pointer");
    expect(script).toContain("assetPointer");
  });

  test("download script requests a generated file download", () => {
    // Arrange
    const conversationId = "conversation-id";
    const fileId = "file-id";

    // Act
    const script = buildDownloadImageScript(conversationId, fileId);

    // Assert
    expect(script).toContain(JSON.stringify(conversationId));
    expect(script).toContain(JSON.stringify(fileId));
    expect(script).toContain("/backend-api/files/download/");
    expect(script).toContain("btoa(binary)");
  });
});

describe("detectChatGptImageType", () => {
  test("detects image types from bytes before falling back to content type", () => {
    // Arrange
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff]);
    const unknown = new Uint8Array([1, 2, 3]);

    // Act
    const results = [
      detectChatGptImageType(png, null),
      detectChatGptImageType(jpeg, null),
      detectChatGptImageType(unknown, "image/webp"),
      detectChatGptImageType(unknown, "text/plain"),
    ];

    // Assert
    expect(results).toEqual([
      { mimeType: "image/png", extension: "png" },
      { mimeType: "image/jpeg", extension: "jpg" },
      { mimeType: "image/webp", extension: "webp" },
      null,
    ]);
  });
});
