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
    expect(proofToken.startsWith("gAAAAAB")).toBe(true);
    expect(proofToken.endsWith("~S")).toBe(true);
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
  test("matches the ChatGPT web text request shape", () => {
    // Arrange
    const now = new Date("2026-05-01T12:00:00.000Z");

    // Act
    const payload = buildChatGptConversationPayload({
      prompt: "answer as oracle",
      messageId: "message-id",
      model: "gpt-5-6-sol-pro",
      now,
      timezoneOffsetMin: 180,
      timezone: "America/Sao_Paulo",
    });

    // Assert
    expect(payload).toMatchObject({
      action: "next",
      parent_message_id: "client-created-root",
      model: "gpt-5-6-sol-pro",
      client_prepare_state: "none",
      timezone_offset_min: 180,
      timezone: "America/Sao_Paulo",
      conversation_mode: { kind: "primary_assistant" },
      system_hints: [],
      force_parallel_switch: "auto",
      thinking_effort: "standard",
    });
    expect(payload.messages).toEqual([
      expect.objectContaining({
        id: "message-id",
        content: { content_type: "text", parts: ["answer as oracle"] },
      }),
    ]);
  });

  test("continues an existing conversation when ids are provided", () => {
    // Arrange
    const now = new Date("2026-05-01T12:00:00.000Z");

    // Act
    const payload = buildChatGptConversationPayload({
      prompt: "follow up",
      conversationId: "conversation-id",
      parentMessageId: "current-node-id",
      messageId: "message-id",
      model: "gpt-5-6-sol-pro",
      now,
    });

    // Assert
    expect(payload).toMatchObject({
      conversation_id: "conversation-id",
      parent_message_id: "current-node-id",
    });
  });

  test("pins requests into a configured ChatGPT project", () => {
    // Arrange
    const now = new Date("2026-05-01T12:00:00.000Z");
    const projectId = "g-p-69ab61612c908191a5a197743a08cb71";

    // Act
    const payload = buildChatGptConversationPayload({
      prompt: "answer in the oracle project",
      messageId: "message-id",
      model: "gpt-5-6-sol-pro",
      now,
      projectId,
    });

    // Assert
    expect(payload).toMatchObject({
      conversation_mode: { kind: "gizmo_interaction", gizmo_id: projectId },
      conversation_template_id: projectId,
      gizmo_id: projectId,
    });
    expect(payload.messages).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({ gizmo_id: projectId }),
      }),
    ]);
  });
});

describe("parseChatGptConversationStream", () => {
  test("extracts conversation id and text from SSE events", () => {
    // Arrange
    const raw = [
      'data: {"v":{"conversation_id":"conversation-id","message":{"metadata":{}}}}',
      'data: {"v":[{"p":"/message/content/parts/0","v":"hello"}]}',
      "data: [DONE]",
    ].join("\n");

    // Act
    const result = parseChatGptConversationStream(raw);

    // Assert
    expect(result).toEqual({ conversationId: "conversation-id", text: "hello" });
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
