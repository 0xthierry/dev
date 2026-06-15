import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { fetchFailedError } from "../shared/errors";
import type { StoredSearchData } from "../types";
import { clearResults, getAllResults, getResult } from "./result-store";
import { restoreFromEntries } from "./session-entries";

afterEach(() => {
  setSystemTime();
  clearResults();
});

describe("restoreFromEntries", () => {
  test("restores valid fresh custom entries", () => {
    // Arrange
    const now = Date.parse("2026-05-01T00:00:00Z");
    setSystemTime(new Date(now));
    const fresh: StoredSearchData = {
      id: "fresh",
      type: "fetch",
      timestamp: now,
      urls: [{ url: "https://example.com", title: "Example", content: "Content", error: null, provider: "http" }],
    };

    // Act
    restoreFromEntries([{ type: "custom", customType: "web-access-results", data: fresh }]);

    // Assert
    expect(getResult("fresh")).toEqual(fresh);
  });

  test("ignores stale entries and entries with unstructured failures", () => {
    // Arrange
    const now = Date.parse("2026-05-01T00:00:00Z");
    setSystemTime(new Date(now));
    const stale: StoredSearchData = { id: "stale", type: "fetch", timestamp: now - 2 * 60 * 60 * 1000, urls: [] };
    const invalidFailure = {
      id: "invalid",
      type: "fetch",
      timestamp: now,
      urls: [{ url: "https://example.com", title: "", content: "", error: "blocked" }],
    };

    // Act
    restoreFromEntries([
      { type: "custom", customType: "web-access-results", data: stale },
      { type: "custom", customType: "web-access-results", data: invalidFailure },
    ]);

    // Assert
    expect(getAllResults()).toEqual([]);
  });

  test("restores entries with structured failures", () => {
    // Arrange
    const now = Date.parse("2026-05-01T00:00:00Z");
    setSystemTime(new Date(now));
    const failed: StoredSearchData = {
      id: "failed",
      type: "fetch",
      timestamp: now,
      urls: [
        {
          url: "https://example.com",
          title: "",
          content: "",
          error: "blocked",
          errorDetails: fetchFailedError("https://example.com", "blocked"),
        },
      ],
    };

    // Act
    restoreFromEntries([{ type: "custom", customType: "web-access-results", data: failed }]);

    // Assert
    expect(getResult("failed")).toEqual(failed);
  });
});
