import { describe, expect, mock, test } from "bun:test";
import { type ChatGptDirectTransport, generateWithChatGptDirect } from "./direct";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHATGPT_HOME_URL = "https://chatgpt.com/";
const CHATGPT_AUTH_SESSION_URL = "https://chatgpt.com/api/auth/session";
const CHATGPT_PREPARE_URL = "https://chatgpt.com/backend-api/sentinel/chat-requirements/prepare";
const CHATGPT_FINALIZE_URL = "https://chatgpt.com/backend-api/sentinel/chat-requirements/finalize";
const CHATGPT_CONVERSATION_URL = "https://chatgpt.com/backend-api/f/conversation";
const CHATGPT_CONVERSATION_POLL_URL = "https://chatgpt.com/backend-api/conversation/conversation-id";
const CHATGPT_DOWNLOAD_METADATA_URL =
  "https://chatgpt.com/backend-api/files/download/file-id?conversation_id=conversation-id&inline=false";
const CHATGPT_IMAGE_DOWNLOAD_URL = "https://chatgpt.com/backend-api/estuary/content?id=file-id";

type FetchKind = "api" | "image";
type RouteOverride = (
  url: string,
  init: RequestInit | undefined,
  kind: FetchKind,
) => Response | undefined | Promise<Response | undefined>;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function textResponse(value: string, status = 200, contentType = "text/plain"): Response {
  return new Response(value, { status, headers: { "content-type": contentType } });
}

function imageResponse(): Response {
  return new Response(pngBytes, { status: 200, headers: { "content-type": "image/png" } });
}

function homeResponse(): Response {
  return textResponse(
    '<html data-build="prod-test" data-seq="123"><script src="/cdn/assets/app.js"></script></html>',
    200,
    "text/html",
  );
}

function transport(override?: RouteOverride): {
  transport: ChatGptDirectTransport;
  fetch: ReturnType<typeof mock>;
  fetchImage: ReturnType<typeof mock>;
  sleep: ReturnType<typeof mock>;
} {
  const fetch = mock(async (url: string, init?: RequestInit) => {
    const overridden = await override?.(url, init, "api");
    if (overridden) return overridden;
    return defaultApiResponse(url, init);
  });
  const fetchImage = mock(async (url: string, init?: RequestInit) => {
    const overridden = await override?.(url, init, "image");
    if (overridden) return overridden;
    if (url === CHATGPT_IMAGE_DOWNLOAD_URL) return imageResponse();
    throw new Error(`Unexpected image fetch URL: ${url}`);
  });
  const sleep = mock(async () => undefined);

  return {
    fetch,
    fetchImage,
    sleep,
    transport: {
      fetch,
      fetchImage,
      getCookies: mock(async () => ({
        browser: "Brave",
        cookies: { "__Secure-next-auth.session-token": "session", "oai-did": "device-id" },
      })),
      randomUUID: mock(() => "uuid"),
      random: mock(() => 0),
      sleep,
      model: "gpt-5-5-thinking",
      timeoutMs: 30_000,
      pollIntervalMs: 1,
    },
  };
}

function defaultApiResponse(url: string, init?: RequestInit): Response {
  if (url === CHATGPT_HOME_URL) return homeResponse();
  if (url === CHATGPT_AUTH_SESSION_URL) return jsonResponse({ accessToken: "access-token" });
  if (url === CHATGPT_PREPARE_URL) {
    return jsonResponse({
      persona: "chatgpt-paid",
      prepare_token: "prepare-token",
      proofofwork: { required: false },
    });
  }
  if (url === CHATGPT_FINALIZE_URL) {
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({ prepare_token: "prepare-token" });
    return jsonResponse({ persona: "chatgpt-paid", token: "chat-token" });
  }
  if (url === CHATGPT_CONVERSATION_URL) {
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      model: "gpt-5-5-thinking",
      parent_message_id: "client-created-root",
      force_parallel_switch: "auto",
    });
    expect((init?.headers as Record<string, string>)["openai-sentinel-chat-requirements-token"]).toBe("chat-token");
    return textResponse('data: {"v":{"conversation_id":"conversation-id","message":{"metadata":{}}}}\n');
  }
  if (url === CHATGPT_CONVERSATION_POLL_URL) {
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
  if (url === CHATGPT_DOWNLOAD_METADATA_URL) {
    return jsonResponse({ download_url: CHATGPT_IMAGE_DOWNLOAD_URL });
  }
  throw new Error(`Unexpected fetch URL: ${url}`);
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
      CHATGPT_HOME_URL,
      CHATGPT_AUTH_SESSION_URL,
      CHATGPT_PREPARE_URL,
      CHATGPT_FINALIZE_URL,
      CHATGPT_CONVERSATION_URL,
      CHATGPT_CONVERSATION_POLL_URL,
      CHATGPT_DOWNLOAD_METADATA_URL,
    ]);
    expect(fake.fetchImage.mock.calls.map((call) => call[0])).toEqual([CHATGPT_IMAGE_DOWNLOAD_URL]);
  });

  test("retries home metadata when the first HTML response is missing build data", async () => {
    // Arrange
    const homeResponses = [textResponse("<html><body>loading</body></html>", 200, "text/html"), homeResponse()];
    const fake = transport((url, _init, kind) => {
      if (kind === "api" && url === CHATGPT_HOME_URL) return homeResponses.shift();
      return undefined;
    });

    // Act
    const result = await generateWithChatGptDirect({ prompt: "generate a fox" }, fake.transport);

    // Assert
    expect(result.images[0]?.providerImageId).toBe("file-id");
    expect(fake.fetch.mock.calls.filter((call) => call[0] === CHATGPT_HOME_URL)).toHaveLength(2);
    expect(fake.sleep).toHaveBeenCalledWith(500, undefined);
  });

  test("retries truncated JSON endpoint responses", async () => {
    // Arrange
    const sessionResponses = [
      textResponse('{"accessToken":"truncated"', 200, "application/json"),
      jsonResponse({ accessToken: "access-token" }),
    ];
    const fake = transport((url, _init, kind) => {
      if (kind === "api" && url === CHATGPT_AUTH_SESSION_URL) return sessionResponses.shift();
      return undefined;
    });

    // Act
    const result = await generateWithChatGptDirect({ prompt: "generate a fox" }, fake.transport);

    // Assert
    expect(result.images[0]?.providerImageId).toBe("file-id");
    expect(fake.fetch.mock.calls.filter((call) => call[0] === CHATGPT_AUTH_SESSION_URL)).toHaveLength(2);
    expect(fake.sleep).toHaveBeenCalledWith(500, undefined);
  });

  test("retries transient network errors on idempotent endpoints", async () => {
    // Arrange
    const networkError = new TypeError("fetch failed");
    const sessionResults = [networkError, jsonResponse({ accessToken: "access-token" })];
    const fake = transport((url, _init, kind) => {
      if (kind !== "api" || url !== CHATGPT_AUTH_SESSION_URL) return undefined;
      const result = sessionResults.shift();
      if (result instanceof Error) throw result;
      return result;
    });

    // Act
    const result = await generateWithChatGptDirect({ prompt: "generate a fox" }, fake.transport);

    // Assert
    expect(result.images[0]?.providerImageId).toBe("file-id");
    expect(fake.fetch.mock.calls.filter((call) => call[0] === CHATGPT_AUTH_SESSION_URL)).toHaveLength(2);
    expect(fake.sleep).toHaveBeenCalledWith(500, undefined);
  });

  test("does not retry conversation creation when a malformed stream still has a conversation id", async () => {
    // Arrange
    const fake = transport((url, _init, kind) => {
      if (kind === "api" && url === CHATGPT_CONVERSATION_URL) {
        return textResponse('garbage prefix {"conversation_id":"conversation-id"', 502, "text/event-stream");
      }
      return undefined;
    });

    // Act
    const result = await generateWithChatGptDirect({ prompt: "generate a fox" }, fake.transport);

    // Assert
    expect(result.images[0]?.providerImageId).toBe("file-id");
    expect(fake.fetch.mock.calls.filter((call) => call[0] === CHATGPT_CONVERSATION_URL)).toHaveLength(1);
  });

  test("retries transient final image download HTTP failures with fetchImage", async () => {
    // Arrange
    const imageResponses = [textResponse("busy", 503, "text/plain"), imageResponse()];
    const fake = transport((url, _init, kind) => {
      if (kind === "image" && url === CHATGPT_IMAGE_DOWNLOAD_URL) return imageResponses.shift();
      return undefined;
    });

    // Act
    const result = await generateWithChatGptDirect({ prompt: "generate a fox" }, fake.transport);

    // Assert
    expect(result.images[0]?.providerImageId).toBe("file-id");
    expect(fake.fetchImage.mock.calls.filter((call) => call[0] === CHATGPT_IMAGE_DOWNLOAD_URL)).toHaveLength(2);
    expect(fake.fetch.mock.calls.some((call) => call[0] === CHATGPT_IMAGE_DOWNLOAD_URL)).toBe(false);
  });

  test("redacts JSON parse diagnostics after retry exhaustion", async () => {
    // Arrange
    const secret = `eyJ${"a".repeat(30)}.${"b".repeat(20)}.${"c".repeat(20)}`;
    const fake = transport((url, _init, kind) => {
      if (kind === "api" && url === CHATGPT_AUTH_SESSION_URL) {
        return textResponse(`{"accessToken":"${secret}","broken":`, 200, "application/json");
      }
      return undefined;
    });

    // Act
    let error: unknown;
    try {
      await generateWithChatGptDirect({ prompt: "generate a fox" }, fake.transport);
    } catch (caught) {
      error = caught;
    }

    // Assert
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain("ChatGPT auth session returned invalid JSON");
    expect(message).toContain("path /api/auth/session");
    expect(message).toContain("body length");
    expect(message).toContain("snippet");
    expect(message).toContain("[redacted-jwt]");
    expect(message).not.toContain(secret);
    expect(fake.fetch.mock.calls.filter((call) => call[0] === CHATGPT_AUTH_SESSION_URL)).toHaveLength(3);
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
