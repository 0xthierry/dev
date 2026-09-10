import { afterEach, describe, expect, mock, test } from "bun:test";
import { parseStreamGenerateResponse, queryWithCookies } from "./gemini-web";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function streamPart(candidateText: string): unknown[] {
  return [null, null, JSON.stringify([null, null, null, null, [[null, [candidateText]]]])];
}

describe("queryWithCookies", () => {
  test("uses the same provider-local dispatcher for redirects and generation", async () => {
    // Arrange
    const fetchMock = mock()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/app/redirected" } }))
      .mockResolvedValueOnce(new Response('"SNlM0e":"fake-token"'))
      .mockResolvedValueOnce(new Response(JSON.stringify([streamPart("Gemini web smoke response")])));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    // Act
    const response = await queryWithCookies("test prompt", { SID: "fake-cookie" });

    // Assert
    expect(response).toBe("Gemini web smoke response");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const dispatcher = fetchMock.mock.calls[0]?.[1]?.dispatcher;
    expect(dispatcher).toBeDefined();
    for (const call of fetchMock.mock.calls) expect(call[1].dispatcher).toBe(dispatcher);
  });
});

describe("parseStreamGenerateResponse", () => {
  test("returns the latest longest candidate text from stream parts", () => {
    // Arrange
    const raw = JSON.stringify([streamPart("Gemini"), streamPart("Gemini web smoke response")]);

    // Act
    const result = parseStreamGenerateResponse(raw);

    // Assert
    expect(result).toBe("Gemini web smoke response");
  });

  test("extracts text from nested candidate content parts", () => {
    // Arrange
    const candidate = [null, ["short", ["A ", "nested ", "answer"]]];
    const raw = JSON.stringify([[null, null, JSON.stringify([null, null, null, null, [candidate]])]]);

    // Act
    const result = parseStreamGenerateResponse(raw);

    // Assert
    expect(result).toBe("shortA nested answer");
  });

  test("throws when the response has no parseable text", () => {
    // Arrange
    const raw = JSON.stringify([[null, null, JSON.stringify([])]]);

    // Act
    const parse = () => parseStreamGenerateResponse(raw);

    // Assert
    expect(parse).toThrow("Gemini Web response did not include text content");
  });

  test("throws when the response has no JSON payload", () => {
    // Arrange
    const raw = "not json";

    // Act
    const parse = () => parseStreamGenerateResponse(raw);

    // Assert
    expect(parse).toThrow("Gemini response did not contain a JSON payload.");
  });
});
