import { describe, expect, test } from "bun:test";
import {
  buildCookieHeader,
  buildGeminiGeneratePayload,
  detectImageType,
  extractGeneratedImageRecords,
  parseGeminiResponseFrames,
  toGeminiImageDownloadUrl,
} from "./web-protocol";

describe("buildCookieHeader", () => {
  test("formats non-empty cookies", () => {
    // Arrange
    const cookies = { a: "1", empty: "", b: "2" };

    // Act
    const header = buildCookieHeader(cookies);

    // Assert
    expect(header).toBe("a=1; b=2");
  });
});

describe("buildGeminiGeneratePayload", () => {
  test("builds a temporary Gemini Web request with prompt and request UUID", () => {
    // Arrange
    const prompt = "Generate a fox";
    const uuid = "REQUEST-ID";

    // Act
    const payload = JSON.parse(buildGeminiGeneratePayload(prompt, uuid)) as unknown[];
    const inner = JSON.parse(payload[1] as string) as unknown[];

    // Assert
    expect(inner[0]).toEqual([prompt, 0, null, null, null, null, 0]);
    expect(inner[45]).toBe(1);
    expect(inner[59]).toBe(uuid);
  });
});

describe("Gemini response parsing", () => {
  test("parses length-prefixed frames and extracts generated image records", () => {
    // Arrange
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
        [
          [
            [
              [null, null, null, [null, null, "a generated fox", "https://lh3.googleusercontent.com/image"]],
              ["image-id"],
            ],
          ],
        ],
      ],
    ];
    const body = JSON.stringify([null, ["cid", "rid"], null, null, [candidate]]);
    const payload = JSON.stringify([["wrb.fr", null, body]]);
    const raw = `)]}'\n\n${payload.length + 1}\n${payload}\n`;

    // Act
    const records = extractGeneratedImageRecords(parseGeminiResponseFrames(raw));

    // Assert
    expect(records).toEqual([
      {
        url: "https://lh3.googleusercontent.com/image",
        imageId: "image-id",
        alt: "a generated fox",
        cid: "cid",
        rid: "rid",
        rcid: "rcid",
      },
    ]);
  });
});

describe("toGeminiImageDownloadUrl", () => {
  test("adds or replaces the Gemini image size suffix", () => {
    // Arrange
    const rawUrl = "https://lh3.googleusercontent.com/image";
    const sizedUrl = "https://lh3.googleusercontent.com/image=s1024-rj";

    // Act
    const first = toGeminiImageDownloadUrl(rawUrl);
    const second = toGeminiImageDownloadUrl(sizedUrl);

    // Assert
    expect(first).toBe("https://lh3.googleusercontent.com/image=s2048-rj");
    expect(second).toBe("https://lh3.googleusercontent.com/image=s2048-rj");
  });
});

describe("detectImageType", () => {
  test("detects image types from magic bytes", () => {
    // Arrange
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const random = new Uint8Array([0x01, 0x02, 0x03]);

    // Act
    const results = [detectImageType(jpeg), detectImageType(png), detectImageType(random)];

    // Assert
    expect(results).toEqual([
      { mimeType: "image/jpeg", extension: "jpg" },
      { mimeType: "image/png", extension: "png" },
      null,
    ]);
  });
});
