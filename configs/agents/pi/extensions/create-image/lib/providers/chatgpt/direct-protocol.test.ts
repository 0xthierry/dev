import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  buildChatGptCommonHeaders,
  buildChatGptConversationPayload,
  buildChatGptCookieHeader,
  buildChatGptFinalizeBody,
  buildChatGptProofConfig,
  buildChatGptRequirementsToken,
  chatGptProofHash,
  extractChatGptBuildInfo,
  extractChatGptGeneratedAssets,
  generateChatGptProofToken,
  parseChatGptConversationStream,
} from "./direct-protocol";

afterEach(() => {
  setSystemTime();
});

describe("extractChatGptBuildInfo", () => {
  test("reads build metadata and script URLs from ChatGPT HTML", () => {
    // Arrange
    const html =
      '<html data-build="prod-build" data-seq="123"><script src="/cdn/assets/app.js"></script><script src="https://chatgpt.com/cdn/assets/chunk.js"></script></html>';

    // Act
    const result = extractChatGptBuildInfo(html);

    // Assert
    expect(result).toEqual({
      clientVersion: "prod-build",
      buildNumber: "123",
      scriptUrls: ["https://chatgpt.com/cdn/assets/app.js", "https://chatgpt.com/cdn/assets/chunk.js"],
    });
  });

  test("reads build metadata with spacing and single-quoted attributes", () => {
    // Arrange
    const html = "<html data-build = 'prod-build' data-seq = '123'></html>";

    // Act
    const result = extractChatGptBuildInfo(html);

    // Assert
    expect(result).toMatchObject({ clientVersion: "prod-build", buildNumber: "123" });
  });

  test("reads build metadata from serialized bootstrap data", () => {
    // Arrange
    const html = '<html><script>self.__next_f.push(["data-build":"prod-build","data-seq":"123"])</script></html>';

    // Act
    const result = extractChatGptBuildInfo(html);

    // Assert
    expect(result).toMatchObject({ clientVersion: "prod-build", buildNumber: "123" });
  });
});

describe("ChatGPT Sentinel helpers", () => {
  test("builds cookie, requirements, proof, finalize, and common header values", () => {
    // Arrange
    setSystemTime(new Date("2026-05-01T12:00:00.000Z"));
    const proofOptions = {
      userAgent: "ua",
      clientVersion: "prod-build",
      scriptUrls: ["https://chatgpt.com/cdn/assets/app.js"],
      random: () => 0,
      randomUUID: () => "uuid",
    };

    // Act
    const cookie = buildChatGptCookieHeader({ a: "1", empty: "", b: "2" });
    const config = buildChatGptProofConfig(proofOptions);
    const requirementsToken = buildChatGptRequirementsToken(config);
    const proofToken = generateChatGptProofToken(
      { required: true, seed: "seed", difficulty: "ffffffff" },
      proofOptions,
      1,
    );
    if (!proofToken) throw new Error("Expected proof token.");
    const finalizeBody = buildChatGptFinalizeBody({ prepareToken: "prepare", proofToken, turnstileToken: "turn" });
    const headers = buildChatGptCommonHeaders({
      cookieHeader: cookie,
      accessToken: "access",
      clientVersion: "prod-build",
      buildNumber: "123",
      deviceId: "device",
      sessionId: "session",
      userAgent: "ua",
    });

    // Assert
    expect(cookie).toBe("a=1; b=2");
    expect(config[4]).toBe("ua");
    expect(config[5]).toBe("https://chatgpt.com/cdn/assets/app.js");
    expect(config[6]).toBe("prod-build");
    expect(requirementsToken.startsWith("gAAAAAC")).toBe(true);
    expect(proofToken?.startsWith("gAAAAAB")).toBe(true);
    expect(proofToken?.endsWith("~S")).toBe(true);
    expect(finalizeBody).toEqual({ prepare_token: "prepare", proofofwork: proofToken, turnstile: "turn" });
    expect(headers).toMatchObject({
      cookie,
      authorization: "Bearer access",
      "oai-client-version": "prod-build",
      "oai-client-build-number": "123",
      "oai-device-id": "device",
      "oai-session-id": "session",
    });
  });

  test("matches the ChatGPT web proof hash shape", () => {
    // Arrange
    const value = "seed";

    // Act
    const hash = chatGptProofHash(value);

    // Assert
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(chatGptProofHash(value)).toBe(hash);
  });
});

describe("buildChatGptConversationPayload", () => {
  test("matches the current ChatGPT web image-generation request shape", () => {
    // Arrange
    const now = new Date("2026-05-01T12:00:00.000Z");

    // Act
    const payload = buildChatGptConversationPayload({
      prompt: "generate a fox",
      messageId: "message-id",
      model: "gpt-5-5-thinking",
      now,
      timezoneOffsetMin: 180,
      timezone: "America/Sao_Paulo",
    });

    // Assert
    expect(payload).toMatchObject({
      action: "next",
      parent_message_id: "client-created-root",
      model: "gpt-5-5-thinking",
      client_prepare_state: "none",
      timezone_offset_min: 180,
      timezone: "America/Sao_Paulo",
      system_hints: [],
      force_parallel_switch: "auto",
      thinking_effort: "standard",
    });
    expect(payload.messages).toEqual([
      expect.objectContaining({
        id: "message-id",
        content: { content_type: "text", parts: ["generate a fox"] },
      }),
    ]);
  });
});

describe("parseChatGptConversationStream", () => {
  test("extracts conversation id and text from SSE events", () => {
    // Arrange
    const raw = [
      'data: {"v":{"conversation_id":"conversation-id","message":{"metadata":{}}}}',
      'data: {"v":[{"p":"/message/content/parts/0","v":"hello"},{"p":"/message/metadata/image_gen_title","v":"fox"}]}',
      "data: [DONE]",
    ].join("\n");

    // Act
    const result = parseChatGptConversationStream(raw);

    // Assert
    expect(result).toEqual({ conversationId: "conversation-id", text: "hello", sawImageSignal: true });
  });

  test("recovers conversation id from a malformed stream prefix", () => {
    // Arrange
    const raw = 'garbage prefix data: {"v":{"conversation_id":"conversation-id"';

    // Act
    const result = parseChatGptConversationStream(raw);

    // Assert
    expect(result).toMatchObject({ conversationId: "conversation-id" });
  });
});

describe("extractChatGptGeneratedAssets", () => {
  test("deduplicates generated image asset pointers from conversation mapping", () => {
    // Arrange
    const conversation = {
      mapping: {
        a: {
          message: {
            status: "finished_successfully",
            content: {
              parts: [
                {
                  content_type: "image_asset_pointer",
                  asset_pointer: "sediment://file-id",
                  size_bytes: 123,
                  width: 1024,
                  height: 1024,
                },
              ],
            },
          },
        },
        b: {
          message: {
            content: { parts: [{ content_type: "image_asset_pointer", asset_pointer: "sediment://file-id" }] },
          },
        },
      },
    };

    // Act
    const assets = extractChatGptGeneratedAssets(conversation);

    // Assert
    expect(assets).toEqual([
      {
        assetPointer: "sediment://file-id",
        fileId: "file-id",
        sizeBytes: 123,
        width: 1024,
        height: 1024,
        status: "finished_successfully",
      },
    ]);
  });
});
