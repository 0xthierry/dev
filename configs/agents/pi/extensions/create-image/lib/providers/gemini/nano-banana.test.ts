import { describe, expect, mock, test } from "bun:test";
import type { GeminiNanoBananaTransport, ImpersonatedFetchClient } from "./nano-banana";
import { generateWithGeminiNanoBanana } from "./nano-banana";

const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);

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

function transport(): { transport: GeminiNanoBananaTransport; imageFetch: ReturnType<typeof mock> } {
  const imageFetch = mock(async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ "content-type": "image/jpeg" }),
    bytes: async () => jpegBytes,
  }));
  const imageClient: ImpersonatedFetchClient = { fetch: imageFetch };
  return {
    imageFetch,
    transport: {
      getCookies: mock(async () => ({
        cookies: { "__Secure-1PSID": "sid", "__Secure-1PSIDTS": "ts" },
        browser: "Brave",
      })),
      randomUUID: mock(() => "REQUEST-UUID"),
      nextRequestId: mock(() => "123456"),
      createImpersonatedClient: mock(() => imageClient),
      fetch: mock(async (url: string) => {
        if (url === "https://gemini.google.com/app") {
          return new Response('{"SNlM0e":"access-token"}', { status: 200 });
        }
        return new Response(geminiImageResponse(), { status: 200 });
      }),
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
