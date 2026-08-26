import { describe, expect, mock, test } from "bun:test";
import type { NormalizedChatGptOracleConfig } from "../../config";
import { askChatGptOracle, type ChatGptOracleTransport } from "./direct";

const CHATGPT_HOME_URL = "https://chatgpt.com/";
const CHATGPT_AUTH_SESSION_URL = "https://chatgpt.com/api/auth/session";
const CHATGPT_PREPARE_URL = "https://chatgpt.com/backend-api/sentinel/chat-requirements/prepare";
const CHATGPT_FINALIZE_URL = "https://chatgpt.com/backend-api/sentinel/chat-requirements/finalize";
const CHATGPT_CONVERSATION_URL = "https://chatgpt.com/backend-api/f/conversation";
const CHATGPT_CONVERSATION_POLL_URL = "https://chatgpt.com/backend-api/conversation/conversation-id";

type RouteOverride = (
  url: string,
  init: RequestInit | undefined,
) => Response | undefined | Promise<Response | undefined>;

function config(overrides: Partial<NormalizedChatGptOracleConfig> = {}): NormalizedChatGptOracleConfig {
  return {
    browser: "Chrome",
    profile: "Default",
    model: "gpt-5-6-pro",
    timeoutMs: 30_000,
    pollIntervalMs: 1,
    ...overrides,
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function textResponse(value: string, status = 200, contentType = "text/plain"): Response {
  return new Response(value, { status, headers: { "content-type": contentType } });
}

function homeResponse(): Response {
  return textResponse(
    '<html data-build="prod-test" data-seq="123"><script src="/cdn/assets/app.js"></script></html>',
    200,
    "text/html",
  );
}

function rateLimitedResponse(retryAfter?: string): Response {
  return new Response(JSON.stringify({ detail: "rate limited" }), {
    status: 429,
    headers: {
      "content-type": "application/json",
      ...(retryAfter ? { "retry-after": retryAfter } : {}),
    },
  });
}

function oraclePollResponse(model?: string, text = "oracle pong"): Response {
  return jsonResponse({
    current_node: "final",
    mapping: {
      thoughts: {
        parent: null,
        message: {
          id: "thoughts-message",
          author: { role: "assistant" },
          recipient: "all",
          status: "finished_successfully",
          end_turn: false,
          metadata: { turn_exchange_id: "turn-id", reasoning_status: "is_reasoning" },
          content: { content_type: "thoughts", parts: [] },
        },
      },
      recap: {
        parent: "thoughts",
        message: {
          id: "recap-message",
          author: { role: "assistant" },
          recipient: "all",
          status: "finished_successfully",
          end_turn: true,
          metadata: { turn_exchange_id: "turn-id", reasoning_status: "reasoning_ended" },
          content: { content_type: "reasoning_recap", parts: [] },
        },
      },
      final: {
        parent: "recap",
        message: {
          id: "message-id",
          author: { role: "assistant" },
          recipient: "all",
          status: "finished_successfully",
          end_turn: true,
          metadata: {
            turn_exchange_id: "turn-id",
            ...(model ? { model_slug: model } : {}),
            finish_details: { type: "stop" },
          },
          content: { content_type: "text", parts: [text] },
        },
      },
    },
  });
}

function commentaryPollResponse(): Response {
  return jsonResponse({
    current_node: "commentary",
    mapping: {
      commentary: {
        parent: null,
        message: {
          id: "commentary-message",
          author: { role: "assistant" },
          recipient: "all",
          channel: "commentary",
          status: "finished_successfully",
          end_turn: true,
          metadata: { turn_exchange_id: "turn-id", model_slug: "gpt-5-6-pro" },
          content: { content_type: "text", parts: ["I will analyze the trade-offs."] },
        },
      },
    },
  });
}

function transport(override?: RouteOverride): {
  transport: ChatGptOracleTransport;
  fetch: ReturnType<typeof mock>;
  sleep: ReturnType<typeof mock>;
} {
  const fetch = mock(async (url: string, init?: RequestInit) => {
    const overridden = await override?.(url, init);
    if (overridden) return overridden;
    return defaultApiResponse(url, init);
  });
  const sleep = mock(async () => undefined);

  return {
    fetch,
    sleep,
    transport: {
      fetch,
      getCookies: mock(async () => ({
        browser: "Chrome" as const,
        cookies: { "__Secure-next-auth.session-token": "session", "oai-did": "device-id" },
      })),
      randomUUID: mock(() => "uuid"),
      random: mock(() => 0),
      sleep,
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
      model: "gpt-5-6-pro",
      parent_message_id: "client-created-root",
      force_parallel_switch: "auto",
    });
    expect((init?.headers as Record<string, string>)["openai-sentinel-chat-requirements-token"]).toBe("chat-token");
    return textResponse(
      'data: {"type":"stream_handoff","conversation_id":"conversation-id","turn_exchange_id":"turn-id","options":[]}\n',
      200,
      "text/event-stream",
    );
  }
  if (url === CHATGPT_CONVERSATION_POLL_URL) return oraclePollResponse("gpt-5-6-pro");
  throw new Error(`Unexpected fetch URL: ${url}`);
}

describe("askChatGptOracle", () => {
  test("asks ChatGPT Web directly and polls the conversation text", async () => {
    // Arrange
    const fake = transport();

    // Act
    const result = await askChatGptOracle({ prompt: "ask the oracle", config: config() }, fake.transport);

    // Assert
    expect(result).toEqual({
      providerId: "chatgpt-web",
      providerLabel: "ChatGPT Web",
      model: "gpt-5-6-pro",
      conversationId: "conversation-id",
      messageId: "message-id",
      currentNode: "message-id",
      projectId: undefined,
      status: "finished_successfully",
      finished: true,
      resumed: false,
      text: "oracle pong",
    });
    expect(fake.transport.getCookies).toHaveBeenCalledWith({ browser: "Chrome", profile: "Default" });
    expect(fake.fetch.mock.calls.map((call) => call[0])).toEqual([
      CHATGPT_HOME_URL,
      CHATGPT_AUTH_SESSION_URL,
      CHATGPT_PREPARE_URL,
      CHATGPT_FINALIZE_URL,
      CHATGPT_CONVERSATION_URL,
      CHATGPT_CONVERSATION_POLL_URL,
    ]);
  });

  test("polls even when the SSE includes content so it can capture the resume node", async () => {
    // Arrange
    const fake = transport((url) => {
      if (url === CHATGPT_CONVERSATION_URL) {
        return textResponse(
          [
            'data: {"v":{"conversation_id":"conversation-id","message":{"metadata":{}}}}',
            'data: {"v":[{"p":"/message/content/parts/0","v":"streamed oracle"}]}',
            'data: {"type":"stream_handoff","conversation_id":"conversation-id","turn_exchange_id":"turn-id","options":[]}',
          ].join("\n"),
          200,
          "text/event-stream",
        );
      }
      if (url === CHATGPT_CONVERSATION_POLL_URL) return oraclePollResponse("gpt-5-6-pro", "streamed oracle");
      return undefined;
    });

    // Act
    const result = await askChatGptOracle({ prompt: "ask", config: config() }, fake.transport);

    // Assert
    expect(result.text).toBe("streamed oracle");
    expect(result.currentNode).toBe("message-id");
    expect(fake.fetch.mock.calls.map((call) => call[0])).toContain(CHATGPT_CONVERSATION_POLL_URL);
  });

  test("keeps polling after a finished commentary message until the Pro answer is complete", async () => {
    // Arrange
    const pollResponses = [commentaryPollResponse(), oraclePollResponse("gpt-5-6-pro", "substantive answer")];
    const fake = transport((url) => {
      if (url === CHATGPT_CONVERSATION_POLL_URL) return pollResponses.shift();
      return undefined;
    });

    // Act
    const result = await askChatGptOracle({ prompt: "ask", config: config() }, fake.transport);

    // Assert
    expect(result.text).toBe("substantive answer");
    expect(fake.fetch.mock.calls.filter((call) => call[0] === CHATGPT_CONVERSATION_POLL_URL)).toHaveLength(2);
    expect(fake.sleep).toHaveBeenCalledWith(1, undefined);
  });

  test("keeps polling the same Pro turn after a rate-limit response", async () => {
    // Arrange
    const pollResponses = [rateLimitedResponse("7"), oraclePollResponse("gpt-5-6-pro", "answer after backoff")];
    const fake = transport((url) => {
      if (url === CHATGPT_CONVERSATION_POLL_URL) return pollResponses.shift();
      return undefined;
    });

    // Act
    const result = await askChatGptOracle({ prompt: "ask", config: config() }, fake.transport);

    // Assert
    expect(result.text).toBe("answer after backoff");
    expect(fake.fetch.mock.calls.filter((call) => call[0] === CHATGPT_CONVERSATION_URL)).toHaveLength(1);
    expect(fake.fetch.mock.calls.filter((call) => call[0] === CHATGPT_CONVERSATION_POLL_URL)).toHaveLength(2);
    expect(fake.sleep).toHaveBeenCalledWith(7_000, undefined);
  });

  test("retains short retries for transient non-rate-limit polling failures", async () => {
    // Arrange
    const pollResponses = [
      textResponse("temporarily unavailable", 503),
      oraclePollResponse("gpt-5-6-pro", "answer after service recovery"),
    ];
    const fake = transport((url) => {
      if (url === CHATGPT_CONVERSATION_POLL_URL) return pollResponses.shift();
      return undefined;
    });

    // Act
    const result = await askChatGptOracle({ prompt: "ask", config: config() }, fake.transport);

    // Assert
    expect(result.text).toBe("answer after service recovery");
    expect(fake.fetch.mock.calls.filter((call) => call[0] === CHATGPT_CONVERSATION_POLL_URL)).toHaveLength(2);
    expect(fake.sleep).toHaveBeenCalledWith(500, expect.any(AbortSignal));
  });

  test("backs off repeated polling rate limits when the server omits Retry-After", async () => {
    // Arrange
    const pollResponses = [
      rateLimitedResponse(),
      rateLimitedResponse(),
      oraclePollResponse("gpt-5-6-pro", "answer after exponential backoff"),
    ];
    const fake = transport((url) => {
      if (url === CHATGPT_CONVERSATION_POLL_URL) return pollResponses.shift();
      return undefined;
    });

    // Act
    const result = await askChatGptOracle({ prompt: "ask", config: config({ pollIntervalMs: 10 }) }, fake.transport);

    // Assert
    expect(result.text).toBe("answer after exponential backoff");
    expect(fake.sleep).toHaveBeenNthCalledWith(1, 10, undefined);
    expect(fake.sleep).toHaveBeenNthCalledWith(2, 20, undefined);
  });

  test("resumes a compatible prior Oracle conversation", async () => {
    // Arrange
    const projectId = "g-p-69ab61612c908191a5a197743a08cb71";
    const fake = transport((url, init) => {
      if (url === CHATGPT_CONVERSATION_URL) {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          conversation_id: "conversation-id",
          parent_message_id: "previous-node-id",
          conversation_template_id: projectId,
        });
        return textResponse(
          'data: {"type":"stream_handoff","conversation_id":"conversation-id","turn_exchange_id":"turn-id","options":[]}\n',
          200,
          "text/event-stream",
        );
      }
      return undefined;
    });

    // Act
    const result = await askChatGptOracle(
      {
        prompt: "follow up",
        config: config({ projectId }),
        state: { conversationId: "conversation-id", currentNode: "previous-node-id", projectId },
      },
      fake.transport,
    );

    // Assert
    expect(result.resumed).toBe(true);
    expect(result.conversationId).toBe("conversation-id");
    expect(result.currentNode).toBe("message-id");
  });

  test("pins the conversation request into the configured ChatGPT project", async () => {
    // Arrange
    const projectId = "g-p-69ab61612c908191a5a197743a08cb71";
    const fake = transport((url, init) => {
      if (url === CHATGPT_CONVERSATION_URL) {
        const body = JSON.parse(String(init?.body));
        expect(body).toMatchObject({
          conversation_mode: { kind: "gizmo_interaction", gizmo_id: projectId },
          conversation_template_id: projectId,
          gizmo_id: projectId,
        });
        expect(body.messages[0].metadata).toMatchObject({ gizmo_id: projectId });
        expect((init?.headers as Record<string, string>).referer).toBe(`https://chatgpt.com/g/${projectId}`);
      }
      return undefined;
    });

    // Act
    const result = await askChatGptOracle({ prompt: "ask", config: config({ projectId }) }, fake.transport);

    // Assert
    expect(result.text).toBe("oracle pong");
  });

  test("retries home metadata when the first HTML response is missing build data", async () => {
    // Arrange
    const homeResponses = [textResponse("<html><body>loading</body></html>", 200, "text/html"), homeResponse()];
    const fake = transport((url) => {
      if (url === CHATGPT_HOME_URL) return homeResponses.shift();
      return undefined;
    });

    // Act
    const result = await askChatGptOracle({ prompt: "ask", config: config() }, fake.transport);

    // Assert
    expect(result.text).toBe("oracle pong");
    expect(fake.fetch.mock.calls.filter((call) => call[0] === CHATGPT_HOME_URL)).toHaveLength(2);
    expect(fake.sleep).toHaveBeenCalledWith(500, undefined);
  });

  test("keeps non-poll rate-limit retries on the existing short backoff", async () => {
    // Arrange
    const authResponses = [rateLimitedResponse("120"), jsonResponse({ accessToken: "access-token" })];
    const fake = transport((url) => {
      if (url === CHATGPT_AUTH_SESSION_URL) return authResponses.shift();
      return undefined;
    });

    // Act
    const result = await askChatGptOracle({ prompt: "ask", config: config() }, fake.transport);

    // Assert
    expect(result.text).toBe("oracle pong");
    expect(fake.fetch.mock.calls.filter((call) => call[0] === CHATGPT_AUTH_SESSION_URL)).toHaveLength(2);
    expect(fake.sleep).toHaveBeenCalledWith(500, undefined);
    expect(fake.sleep).not.toHaveBeenCalledWith(120_000, undefined);
  });

  test("rejects answers whose server-reported model is missing", async () => {
    // Arrange
    const fake = transport((url) => (url === CHATGPT_CONVERSATION_POLL_URL ? oraclePollResponse() : undefined));

    // Act
    const promise = askChatGptOracle({ prompt: "ask", config: config() }, fake.transport);

    // Assert
    await expect(promise).rejects.toThrow("did not report the model used");
  });

  test("rejects answers whose server-reported model differs from the configured model", async () => {
    // Arrange
    const fake = transport((url) =>
      url === CHATGPT_CONVERSATION_POLL_URL ? oraclePollResponse("gpt-5-5-pro") : undefined,
    );

    // Act
    const promise = askChatGptOracle({ prompt: "ask", config: config() }, fake.transport);

    // Assert
    await expect(promise).rejects.toThrow('used model "gpt-5-5-pro" instead of configured Oracle model "gpt-5-6-pro"');
  });

  test("fails clearly when configured ChatGPT cookies are missing", async () => {
    // Arrange
    const fake = transport();
    fake.transport.getCookies = mock(async () => null);

    // Act
    const promise = askChatGptOracle({ prompt: "ask", config: config() }, fake.transport);

    // Assert
    await expect(promise).rejects.toThrow("ChatGPT Web cookies were not found for Chrome profile");
  });
});
