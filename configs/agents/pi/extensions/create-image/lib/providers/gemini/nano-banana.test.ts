import { describe, expect, mock, test } from "bun:test";
import type { GeminiNanoBananaTransport, ImpersonatedFetchClient } from "./nano-banana";
import { generateWithGeminiNanoBanana } from "./nano-banana";
import { GEMINI_APP_URL, GEMINI_GENERATE_URL } from "./web-protocol";

const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
const randomBytes = new Uint8Array([0x01, 0x02, 0x03]);

type FetchKind = "api" | "image";
type RouteOverride = (
  url: string,
  init: RequestInit | undefined,
  kind: FetchKind,
) => Response | ImpersonatedResponseStub | undefined | Promise<Response | ImpersonatedResponseStub | undefined>;

type ImpersonatedResponseStub = {
  ok: boolean;
  status: number;
  headers: Headers;
  bytes(): Promise<Uint8Array>;
};

function framedPayload(payload: unknown): string {
  const text = JSON.stringify(payload);
  return `)]}'\n\n${text.length + 1}\n${text}\n`;
}

function geminiImageResponse(): string {
  const candidate = [
    "rcid",
    [""],
    null,
    null,
    null,
    null,
    null,
    null,
    [2],
    null,
    null,
    null,
    [
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      [[[[null, null, null, [null, null, "generated", "https://lh3.googleusercontent.com/image"]], ["image-id"]]]],
    ],
  ];
  const body = JSON.stringify([null, ["cid", "rid"], null, null, [candidate]]);
  return framedPayload([["wrb.fr", null, body]]);
}

function geminiNoImageResponse(): string {
  return framedPayload([["wrb.fr", null, JSON.stringify([null, ["cid", "rid"], null, null, []])]]);
}

function textResponse(value: string, status = 200, contentType = "text/plain"): Response {
  return new Response(value, { status, headers: { "content-type": contentType } });
}

function impersonatedResponse(bytes: Uint8Array, status = 200, contentType = "image/jpeg"): ImpersonatedResponseStub {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": contentType }),
    bytes: async () => bytes,
  };
}

function transport(override?: RouteOverride): {
  transport: GeminiNanoBananaTransport;
  fetch: ReturnType<typeof mock>;
  imageFetch: ReturnType<typeof mock>;
  sleep: ReturnType<typeof mock>;
} {
  const imageFetch = mock(async (url: string, init?: RequestInit) => {
    const overridden = await override?.(url, init, "image");
    if (overridden) return overridden as ImpersonatedResponseStub;
    return impersonatedResponse(jpegBytes);
  });
  const imageClient: ImpersonatedFetchClient = { fetch: imageFetch };
  const fetch = mock(async (url: string, init?: RequestInit) => {
    const overridden = await override?.(url, init, "api");
    if (overridden) return overridden as Response;
    if (url === GEMINI_APP_URL) return textResponse('{"SNlM0e":"access-token"}');
    if (url.startsWith(GEMINI_GENERATE_URL)) return textResponse(geminiImageResponse());
    throw new Error(`Unexpected Gemini fetch URL: ${url}`);
  });
  const sleep = mock(async () => undefined);

  return {
    fetch,
    imageFetch,
    sleep,
    transport: {
      getCookies: mock(async () => ({
        cookies: { "__Secure-1PSID": "sid", "__Secure-1PSIDTS": "ts" },
        browser: "Brave",
      })),
      randomUUID: mock(() => "REQUEST-UUID"),
      nextRequestId: mock(() => "123456"),
      createImpersonatedClient: mock(() => imageClient),
      fetch,
      sleep,
    },
  };
}

describe("generateWithGeminiNanoBanana", () => {
  test("generates and downloads images with browser cookies and impersonated fetch", async () => {
    // Arrange
    const fake = transport();

    // Act
    const result = await generateWithGeminiNanoBanana({ prompt: "generate a fox" }, fake.transport);

    // Assert
    expect(result).toMatchObject({ providerId: "nano-banana", providerLabel: "Nano Banana" });
    expect(result.images).toEqual([
      { bytes: jpegBytes, mimeType: "image/jpeg", extension: "jpg", providerImageId: "image-id" },
    ]);
    expect(fake.imageFetch).toHaveBeenCalledWith(
      "https://lh3.googleusercontent.com/image=s2048-rj",
      expect.objectContaining({
        headers: expect.objectContaining({ cookie: "__Secure-1PSID=sid; __Secure-1PSIDTS=ts" }),
      }),
    );
  });

  test("retries app bootstrap responses without an access token", async () => {
    // Arrange
    const appResponses = [textResponse("<html></html>", 200, "text/html"), textResponse('{"SNlM0e":"access-token"}')];
    const fake = transport((url, _init, kind) => {
      if (kind === "api" && url === GEMINI_APP_URL) return appResponses.shift();
      return undefined;
    });

    // Act
    const result = await generateWithGeminiNanoBanana({ prompt: "generate a fox" }, fake.transport);

    // Assert
    expect(result.images[0]?.providerImageId).toBe("image-id");
    expect(fake.fetch.mock.calls.filter((call) => call[0] === GEMINI_APP_URL)).toHaveLength(2);
    expect(fake.sleep).toHaveBeenCalledWith(500, undefined);
  });

  test("retries image generation when Gemini returns no image records", async () => {
    // Arrange
    const generationResponses = [textResponse(geminiNoImageResponse()), textResponse(geminiImageResponse())];
    const fake = transport((url, _init, kind) => {
      if (kind === "api" && url.startsWith(GEMINI_GENERATE_URL)) return generationResponses.shift();
      return undefined;
    });

    // Act
    const result = await generateWithGeminiNanoBanana({ prompt: "generate a fox" }, fake.transport);

    // Assert
    expect(result.images[0]?.providerImageId).toBe("image-id");
    expect(fake.fetch.mock.calls.filter((call) => String(call[0]).startsWith(GEMINI_GENERATE_URL))).toHaveLength(2);
    expect(fake.sleep).toHaveBeenCalledWith(500, undefined);
  });

  test("retries unparsable image generation responses", async () => {
    // Arrange
    const generationResponses = [textResponse(")]}'\n\n3\n[x\n"), textResponse(geminiImageResponse())];
    const fake = transport((url, _init, kind) => {
      if (kind === "api" && url.startsWith(GEMINI_GENERATE_URL)) return generationResponses.shift();
      return undefined;
    });

    // Act
    const result = await generateWithGeminiNanoBanana({ prompt: "generate a fox" }, fake.transport);

    // Assert
    expect(result.images[0]?.providerImageId).toBe("image-id");
    expect(fake.fetch.mock.calls.filter((call) => String(call[0]).startsWith(GEMINI_GENERATE_URL))).toHaveLength(2);
    expect(fake.sleep).toHaveBeenCalledWith(500, undefined);
  });

  test("retries unrecognized generated image bytes", async () => {
    // Arrange
    const imageResponses = [impersonatedResponse(randomBytes), impersonatedResponse(jpegBytes)];
    const fake = transport((url, _init, kind) => {
      if (kind === "image" && url === "https://lh3.googleusercontent.com/image=s2048-rj") {
        return imageResponses.shift();
      }
      return undefined;
    });

    // Act
    const result = await generateWithGeminiNanoBanana({ prompt: "generate a fox" }, fake.transport);

    // Assert
    expect(result.images[0]?.providerImageId).toBe("image-id");
    expect(
      fake.imageFetch.mock.calls.filter((call) => call[0] === "https://lh3.googleusercontent.com/image=s2048-rj"),
    ).toHaveLength(2);
    expect(fake.sleep).toHaveBeenCalledWith(500, undefined);
  });

  test("retries retryable generated image HTTP failures", async () => {
    // Arrange
    const imageResponses = [
      impersonatedResponse(new TextEncoder().encode("busy"), 503, "text/plain"),
      impersonatedResponse(jpegBytes),
    ];
    const fake = transport((url, _init, kind) => {
      if (kind === "image" && url === "https://lh3.googleusercontent.com/image=s2048-rj") {
        return imageResponses.shift();
      }
      return undefined;
    });

    // Act
    const result = await generateWithGeminiNanoBanana({ prompt: "generate a fox" }, fake.transport);

    // Assert
    expect(result.images[0]?.providerImageId).toBe("image-id");
    expect(
      fake.imageFetch.mock.calls.filter((call) => call[0] === "https://lh3.googleusercontent.com/image=s2048-rj"),
    ).toHaveLength(2);
    expect(fake.sleep).toHaveBeenCalledWith(500, undefined);
  });

  test("redacts image-byte diagnostics after retry exhaustion", async () => {
    // Arrange
    const secret = `eyJ${"a".repeat(30)}.${"b".repeat(20)}.${"c".repeat(20)}`;
    const badBytes = new TextEncoder().encode(`<html>${secret}</html>`);
    const fake = transport((url, _init, kind) => {
      if (kind === "image" && url === "https://lh3.googleusercontent.com/image=s2048-rj") {
        return impersonatedResponse(badBytes, 200, "text/html");
      }
      return undefined;
    });

    // Act
    let error: unknown;
    try {
      await generateWithGeminiNanoBanana({ prompt: "generate a fox" }, fake.transport);
    } catch (caught) {
      error = caught;
    }

    // Assert
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : "";
    expect(message).toContain("Generated image download did not return recognized image bytes");
    expect(message).toContain("location lh3.googleusercontent.com/image=s2048-rj");
    expect(message).toContain("content-type text/html");
    expect(message).toContain("magic");
    expect(message).toContain("[redacted-jwt]");
    expect(message).not.toContain(secret);
    expect(
      fake.imageFetch.mock.calls.filter((call) => call[0] === "https://lh3.googleusercontent.com/image=s2048-rj"),
    ).toHaveLength(3);
  });

  test("fails clearly when Gemini cookies are unavailable", async () => {
    // Arrange
    const fake = transport();
    fake.transport.getCookies = mock(async () => null);

    // Act
    const promise = generateWithGeminiNanoBanana({ prompt: "generate a fox" }, fake.transport);

    // Assert
    await expect(promise).rejects.toThrow("Gemini Web cookies were not found");
  });
});
