import { describe, expect, test } from "bun:test";
import {
  hasChatGptSessionCookie,
  isChatGptSessionCookieName,
  normalizeBrowserName,
  supportedBrowserNames,
} from "./browser-cookies";

describe("ChatGPT browser cookie helpers", () => {
  test("normalizes supported browser names", () => {
    // Arrange
    const names = ["brave", "Chromium", " chrome ", "Safari"];

    // Act
    const results = names.map((name) => normalizeBrowserName(name));

    // Assert
    expect(results).toEqual(["Brave", "Chromium", "Chrome", null]);
    expect(supportedBrowserNames()).toContain("Chrome");
  });

  test("recognizes normal and chunked ChatGPT session cookies", () => {
    // Arrange
    const names = [
      "__Secure-next-auth.session-token",
      "__Secure-next-auth.session-token.0",
      "__Secure-next-auth.callback-url",
    ];

    // Act
    const results = names.map((name) => isChatGptSessionCookieName(name));
    const hasSession = hasChatGptSessionCookie({ "__Secure-next-auth.session-token.1": "value" });
    const missingSession = hasChatGptSessionCookie({ "__Secure-next-auth.callback-url": "value" });

    // Assert
    expect(results).toEqual([true, true, false]);
    expect(hasSession).toBe(true);
    expect(missingSession).toBe(false);
  });
});
