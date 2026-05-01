import { describe, expect, test } from "bun:test";
import { getGoogleCookies } from "./chrome-cookies";

describe("web-access Chrome cookie live contract", () => {
  test("reads required Gemini Web cookies from Brave/Chromium/Chrome", async () => {
    const result = await getGoogleCookies({ requiredCookies: ["__Secure-1PSID", "__Secure-1PSIDTS"] });

    expect(result?.browser).toBeTruthy();
    expect(result?.cookies["__Secure-1PSID"]).toBeTruthy();
    expect(result?.cookies["__Secure-1PSIDTS"]).toBeTruthy();
  }, 30_000);
});
