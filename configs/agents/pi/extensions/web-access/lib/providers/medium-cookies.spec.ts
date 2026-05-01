import { describe, expect, test } from "bun:test";
import { extractViaAuthenticatedHttp } from "../content/authenticated-http";
import { classifyFetchTarget } from "../content/target";
import { getMediumAuthHeaders } from "./medium-cookies";

const ENABLE_MEDIUM_COOKIE_SPEC = process.env.PI_WEB_ACCESS_MEDIUM_COOKIE_SPEC === "1";
const MEDIUM_TEST_URL = process.env.PI_WEB_ACCESS_MEDIUM_TEST_URL;

describe("web-access Medium cookie live contract", () => {
  test("reads configured Medium cookies without exposing values", async () => {
    // Arrange
    if (!ENABLE_MEDIUM_COOKIE_SPEC) {
      console.warn("Skipping Medium cookie live contract. Set PI_WEB_ACCESS_MEDIUM_COOKIE_SPEC=1 to enable.");
      return;
    }

    // Act
    const headers = await getMediumAuthHeaders("https://medium.com/");

    // Assert
    expect(headers?.Cookie).toBeTruthy();
    expect(headers?.Cookie).toContain("=");
  }, 30_000);

  test("optionally fetches a configured Medium URL through authenticated HTTP", async () => {
    // Arrange
    if (!ENABLE_MEDIUM_COOKIE_SPEC || !MEDIUM_TEST_URL) {
      console.warn(
        "Skipping Medium authenticated fetch live contract. Set PI_WEB_ACCESS_MEDIUM_COOKIE_SPEC=1 and PI_WEB_ACCESS_MEDIUM_TEST_URL to enable.",
      );
      return;
    }
    const classified = classifyFetchTarget(MEDIUM_TEST_URL);
    expect(classified.ok).toBe(true);
    if (!classified.ok) throw new Error("Expected a valid Medium test URL.");

    // Act
    const result = await extractViaAuthenticatedHttp(classified.target);

    // Assert
    expect(result).toBeTruthy();
    expect(result?.error).toBeNull();
    expect(result?.content.length ?? 0).toBeGreaterThan(100);
  }, 60_000);
});
