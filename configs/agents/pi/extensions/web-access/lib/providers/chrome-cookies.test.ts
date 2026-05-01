import { describe, expect, test } from "bun:test";
import { getGoogleCookieHosts, isGoogleCookieName } from "./chrome-cookies";

describe("chrome cookie helpers", () => {
  test("includes Gemini, Google account, and bare Google hosts", () => {
    // Arrange
    const expectedHosts = ["gemini.google.com", "accounts.google.com", "www.google.com", "google.com"];

    // Act
    const hosts = getGoogleCookieHosts();

    // Assert
    expect(hosts).toEqual(expectedHosts);
  });

  test("recognizes only supported Google auth cookie names", () => {
    // Arrange
    const supported = ["__Secure-1PSID", "__Secure-1PSIDTS"];
    const unsupported = "random_cookie";

    // Act
    const supportedResults = supported.map((name) => isGoogleCookieName(name));
    const unsupportedResult = isGoogleCookieName(unsupported);

    // Assert
    expect(supportedResults).toEqual([true, true]);
    expect(unsupportedResult).toBe(false);
  });
});
