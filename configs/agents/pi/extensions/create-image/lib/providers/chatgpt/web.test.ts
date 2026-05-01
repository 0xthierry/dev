import { describe, expect, mock, test } from "bun:test";
import type { ChatGptAgentBrowserTransport } from "./agent-browser";
import type { ChatGptDirectTransport } from "./direct";
import { type ChatGptWebTransport, generateWithChatGptWeb } from "./web";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function encodeEvalResult(value: unknown): string {
  return JSON.stringify(JSON.stringify(value));
}

function failingDirectTransport(): ChatGptDirectTransport {
  return {
    fetch: mock(async () => {
      throw new Error("direct fetch should not be called");
    }),
    fetchImage: mock(async () => {
      throw new Error("direct image fetch should not be called");
    }),
    getCookies: mock(async () => {
      throw new Error("direct failed");
    }),
    randomUUID: mock(() => "uuid"),
    random: mock(() => 0),
    now: mock(() => new Date("2026-05-01T12:00:00.000Z")),
    sleep: mock(async () => undefined),
    model: "gpt-5-5-thinking",
    timeoutMs: 30_000,
    pollIntervalMs: 1,
  };
}

function fallbackTransport(): { transport: ChatGptAgentBrowserTransport; runAgentBrowser: ReturnType<typeof mock> } {
  const runAgentBrowser = mock(async (args: string[]) => {
    const command = args.join(" ");
    if (command.startsWith("tab new")) return "✓ ChatGPT\n";
    if (command === "wait #prompt-textarea") return "✓ Done\n";
    if (command === 'click button[aria-label="Send prompt"]') return "✓ Done\n";
    if (command === "tab close pi-chatgpt-image-test") return "✓ Closed\n";
    if (command === "eval --stdin") {
      const call = runAgentBrowser.mock.calls.filter((entry) => entry[0].join(" ") === "eval --stdin").length;
      if (call === 1) return encodeEvalResult({ ok: true });
      if (call === 2) {
        return encodeEvalResult({
          ok: true,
          conversationId: "conversation-id",
          status: 200,
          assets: [{ assetPointer: "sediment://file-id", fileId: "file-id" }],
        });
      }
      return encodeEvalResult({
        ok: true,
        status: 200,
        contentType: "image/png",
        bytes: pngBytes.length,
        magicHex: Buffer.from(pngBytes).toString("hex"),
        base64: Buffer.from(pngBytes).toString("base64"),
      });
    }
    throw new Error(`Unexpected agent-browser command: ${command}`);
  });

  return {
    runAgentBrowser,
    transport: {
      runAgentBrowser,
      sleep: mock(async () => undefined),
      randomLabel: () => "pi-chatgpt-image-test",
      timeoutMs: 30_000,
      pollIntervalMs: 1,
    },
  };
}

function successfulDirectTransport(): ChatGptDirectTransport {
  const imageResponse = new Response(pngBytes, { status: 200, headers: { "content-type": "image/png" } });
  const fetch = mock(async (url: string, init?: RequestInit) => {
    if (url === "https://chatgpt.com/") return new Response('<html data-build="prod-test" data-seq="123"></html>');
    if (url === "https://chatgpt.com/api/auth/session") return Response.json({ accessToken: "access-token" });
    if (url === "https://chatgpt.com/backend-api/sentinel/chat-requirements/prepare") {
      return Response.json({ prepare_token: "prepare", proofofwork: { required: false } });
    }
    if (url === "https://chatgpt.com/backend-api/sentinel/chat-requirements/finalize") {
      return Response.json({ token: "chat-token" });
    }
    if (url === "https://chatgpt.com/backend-api/f/conversation") {
      return new Response('data: {"v":{"conversation_id":"conversation-id"}}\n');
    }
    if (url === "https://chatgpt.com/backend-api/conversation/conversation-id") {
      return Response.json({
        mapping: {
          node: {
            message: {
              content: { parts: [{ content_type: "image_asset_pointer", asset_pointer: "sediment://file-id" }] },
            },
          },
        },
      });
    }
    if (url === "https://chatgpt.com/backend-api/files/download/file-id?conversation_id=conversation-id&inline=false") {
      return Response.json({ download_url: "https://chatgpt.com/backend-api/estuary/content?id=file-id" });
    }
    if (url === "https://chatgpt.com/backend-api/estuary/content?id=file-id") return imageResponse;
    throw new Error(`Unexpected fetch URL: ${url} ${String(init?.method ?? "GET")}`);
  });

  return {
    fetch,
    fetchImage: fetch,
    getCookies: mock(async () => ({ browser: "Brave", cookies: { "__Secure-next-auth.session-token": "session" } })),
    randomUUID: mock(() => "uuid"),
    random: mock(() => 0),
    now: mock(() => new Date("2026-05-01T12:00:00.000Z")),
    sleep: mock(async () => undefined),
    model: "gpt-5-5-thinking",
    timeoutMs: 30_000,
    pollIntervalMs: 1,
  };
}

describe("generateWithChatGptWeb", () => {
  test("uses direct HTTP generation before the browser/CDP fallback", async () => {
    // Arrange
    const fallback = fallbackTransport();
    const transport: ChatGptWebTransport = { direct: successfulDirectTransport(), fallback: fallback.transport };

    // Act
    const result = await generateWithChatGptWeb({ prompt: "generate a fox" }, transport);

    // Assert
    expect(result.images[0]?.providerImageId).toBe("file-id");
    expect(fallback.runAgentBrowser).not.toHaveBeenCalled();
  });

  test("falls back to browser/CDP generation when direct HTTP fails", async () => {
    // Arrange
    const fallback = fallbackTransport();
    const transport: ChatGptWebTransport = { direct: failingDirectTransport(), fallback: fallback.transport };

    // Act
    const result = await generateWithChatGptWeb({ prompt: "generate a fox" }, transport);

    // Assert
    expect(result).toEqual({
      providerId: "chatgpt-web",
      providerLabel: "ChatGPT Web",
      images: [{ bytes: pngBytes, mimeType: "image/png", extension: "png", providerImageId: "file-id" }],
    });
    expect(fallback.runAgentBrowser).toHaveBeenCalled();
  });

  test("does not run browser/CDP fallback when direct generation is aborted", async () => {
    // Arrange
    const fallback = fallbackTransport();
    const direct = failingDirectTransport();
    direct.getCookies = mock(async () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      throw error;
    });
    const transport: ChatGptWebTransport = { direct, fallback: fallback.transport };

    // Act
    const promise = generateWithChatGptWeb({ prompt: "generate a fox" }, transport);

    // Assert
    await expect(promise).rejects.toThrow("aborted");
    expect(fallback.runAgentBrowser).not.toHaveBeenCalled();
  });

  test("reports both direct and fallback failures", async () => {
    // Arrange
    const fallback = fallbackTransport();
    fallback.runAgentBrowser.mockImplementation(async () => {
      throw new Error("fallback failed");
    });
    const transport: ChatGptWebTransport = { direct: failingDirectTransport(), fallback: fallback.transport };

    // Act
    const promise = generateWithChatGptWeb({ prompt: "generate a fox" }, transport);

    // Assert
    await expect(promise).rejects.toThrow("ChatGPT direct Web image generation failed: direct failed");
    await expect(promise).rejects.toThrow("Browser/CDP fallback also failed: fallback failed");
  });
});
