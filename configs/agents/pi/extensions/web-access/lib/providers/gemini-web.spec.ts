import { describe, expect, test } from "bun:test";
import { isGeminiWebAvailable, queryWithCookies } from "./gemini-web";

describe("web-access Gemini Web live contract", () => {
  test("validates Brave/Chromium cookie access and Gemini Web responses", async () => {
    const cookies = await isGeminiWebAvailable();
    expect(cookies).toBeTruthy();
    if (!cookies)
      throw new Error("Gemini Web cookies were not found. Sign into gemini.google.com in Brave or Chromium.");

    const response = await queryWithCookies("Reply with exactly these words: Gemini web smoke", cookies, {
      timeoutMs: 60_000,
    });
    expect(response.toLowerCase()).toContain("gemini web smoke");
  }, 90_000);
});
