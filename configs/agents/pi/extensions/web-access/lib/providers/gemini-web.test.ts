import { describe, expect, test } from "bun:test";
import { parseStreamGenerateResponse } from "./gemini-web";

function streamPart(candidateText: string): unknown[] {
  return [null, null, JSON.stringify([null, null, null, null, [[null, [candidateText]]]])];
}

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
