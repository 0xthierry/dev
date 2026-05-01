import { describe, expect, mock, test } from "bun:test";
import { type ChatGptDirectTransport, generateWithChatGptDirect } from "./direct";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function textResponse(value: string, status = 200): Response {
  return new Response(value, { status, headers: { "content-type": "text/plain" } });
}

function imageResponse(): Response {
  return new Response(pngBytes, { status: 200, headers: { "content-type": "image/png" } });
}

function transport(): { transport: ChatGptDirectTransport; fetch: ReturnType<typeof mock> } {
  const fetch = mock(async (url: string, init?: RequestInit) => {
    if (url === "https://chatgpt.com/") {
      return textResponse(
        '<html data-build="prod-test" data-seq="123"><script src="/cdn/assets/app.js"></script></html>',
      );
    }
    if (url === "https://chatgpt.com/api/auth/session") return jsonResponse({ accessToken: "access-token" });
    if (url === "https://chatgpt.com/backend-api/sentinel/chat-requirements/prepare") {
      return jsonResponse({
        persona: "chatgpt-paid",
        prepare_token: "prepare-token",
        proofofwork: { required: false },
      });
    }
    if (url === "https://chatgpt.com/backend-api/sentinel/chat-requirements/finalize") {
      const body = JSON.parse(String(init?.body));
      expect(body).toEqual({ prepare_token: "prepare-token" });
      return jsonResponse({ persona: "chatgpt-paid", token: "chat-token" });
    }
    if (url === "https://chatgpt.com/backend-api/f/conversation") {
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "gpt-5-5-thinking",
        parent_message_id: "client-created-root",
        force_parallel_switch: "auto",
      });
      expect((init?.headers as Record<string, string>)["openai-sentinel-chat-requirements-token"]).toBe("chat-token");
      return textResponse('data: {"v":{"conversation_id":"conversation-id","message":{"metadata":{}}}}\n');
    }
    if (url === "https://chatgpt.com/backend-api/conversation/conversation-id") {
      return jsonResponse({
        mapping: {
          node: {
            message: {
              status: "finished_successfully",
              content: {
                parts: [{ content_type: "image_asset_pointer", asset_pointer: "sediment://file-id" }],
              },
            },
          },
        },
      });
    }
    if (url === "https://chatgpt.com/backend-api/files/download/file-id?conversation_id=conversation-id&inline=false") {
      return jsonResponse({ download_url: "https://chatgpt.com/backend-api/estuary/content?id=file-id" });
    }
    if (url === "https://chatgpt.com/backend-api/estuary/content?id=file-id") return imageResponse();
    throw new Error(`Unexpected fetch URL: ${url}`);
  });

  return {
    fetch,
    transport: {
      fetch,
      fetchImage: fetch,
      getCookies: mock(async () => ({
        browser: "Brave",
        cookies: { "__Secure-next-auth.session-token": "session", "oai-did": "device-id" },
      })),
      randomUUID: mock(() => "uuid"),
      random: mock(() => 0),
      now: mock(() => new Date("2026-05-01T12:00:00.000Z")),
      sleep: mock(async () => undefined),
      model: "gpt-5-5-thinking",
      timeoutMs: 30_000,
      pollIntervalMs: 1,
    },
  };
}

describe("generateWithChatGptDirect", () => {
  test("generates and downloads images through direct ChatGPT Web HTTP", async () => {
    // Arrange
    const fake = transport();

    // Act
    const result = await generateWithChatGptDirect({ prompt: "generate a fox" }, fake.transport);

    // Assert
    expect(result).toEqual({
      providerId: "chatgpt-web",
      providerLabel: "ChatGPT Web",
      images: [{ bytes: pngBytes, mimeType: "image/png", extension: "png", providerImageId: "file-id" }],
    });
    expect(fake.fetch.mock.calls.map((call) => call[0])).toEqual([
      "https://chatgpt.com/",
      "https://chatgpt.com/api/auth/session",
      "https://chatgpt.com/backend-api/sentinel/chat-requirements/prepare",
      "https://chatgpt.com/backend-api/sentinel/chat-requirements/finalize",
      "https://chatgpt.com/backend-api/f/conversation",
      "https://chatgpt.com/backend-api/conversation/conversation-id",
      "https://chatgpt.com/backend-api/files/download/file-id?conversation_id=conversation-id&inline=false",
      "https://chatgpt.com/backend-api/estuary/content?id=file-id",
    ]);
  });

  test("fails clearly when ChatGPT cookies are missing", async () => {
    // Arrange
    const fake = transport();
    fake.transport.getCookies = mock(async () => null);

    // Act
    const promise = generateWithChatGptDirect({ prompt: "generate a fox" }, fake.transport);

    // Assert
    await expect(promise).rejects.toThrow("ChatGPT Web cookies were not found");
  });
});
