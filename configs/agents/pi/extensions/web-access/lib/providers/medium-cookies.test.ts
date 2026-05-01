import { describe, expect, test } from "bun:test";
import {
  buildCookieHeader,
  isMediumUrl,
  mediumCookieHostsForUrl,
  mediumCookieProfileCandidates,
  normalizeMediumConfig,
} from "./medium-cookies";

describe("medium cookie helpers", () => {
  test("normalizes Medium cookie configuration", () => {
    // Arrange
    const raw = { enabled: true, profile: " Profile 1 " };

    // Act
    const result = normalizeMediumConfig(raw);

    // Assert
    expect(result).toEqual({ enabled: true, profile: "Profile 1" });
  });

  test("keeps Medium cookie use disabled by default", () => {
    // Arrange
    const raw = undefined;

    // Act
    const result = normalizeMediumConfig(raw);

    // Assert
    expect(result).toEqual({ enabled: false, profile: undefined });
  });

  test("recognizes only medium.com hosts", () => {
    // Arrange
    const urls = [
      "https://medium.com/@user/post",
      "https://www.medium.com/p/post",
      "https://sub.medium.com/post",
      "https://evilmedium.com/post",
      "not a url",
    ];

    // Act
    const results = urls.map((url) => isMediumUrl(url));

    // Assert
    expect(results).toEqual([true, true, true, false, false]);
  });

  test("builds cookie lookup hosts for Medium URLs", () => {
    // Arrange
    const apex = "https://medium.com/@user/post";
    const subdomain = "https://engineering.medium.com/post";
    const nonMedium = "https://example.com/post";

    // Act
    const apexHosts = mediumCookieHostsForUrl(apex);
    const subdomainHosts = mediumCookieHostsForUrl(subdomain);
    const nonMediumHosts = mediumCookieHostsForUrl(nonMedium);

    // Assert
    expect(apexHosts).toEqual(["medium.com"]);
    expect(subdomainHosts).toEqual(["medium.com", "engineering.medium.com"]);
    expect(nonMediumHosts).toEqual([]);
  });

  test("formats non-empty cookies as a Cookie header", () => {
    // Arrange
    const cookies = { sid: "secret", uid: " user ", empty: " " };

    // Act
    const result = buildCookieHeader(cookies);

    // Assert
    expect(result).toBe("sid=secret; uid=user");
  });

  test("builds browser profile candidates for Medium cookie lookup", () => {
    // Arrange
    const config = { braveProfile: " Brave ", chromeProfile: " Chrome " };
    const explicitMedium = { enabled: true, profile: "Medium Profile" };
    const fallbackMedium = { enabled: true, profile: undefined };

    // Act
    const explicitProfiles = mediumCookieProfileCandidates(config, explicitMedium);
    const fallbackProfiles = mediumCookieProfileCandidates(config, fallbackMedium);

    // Assert
    expect(explicitProfiles).toEqual(["Medium Profile"]);
    expect(fallbackProfiles).toEqual(["Brave", "Chrome", undefined]);
  });
});
