import { afterEach, describe, expect, test } from "bun:test";
import type { StoredSearchData } from "../types";
import { clearResults, deleteResult, generateId, getAllResults, getResult, storeResult } from "./result-store";
import { restoreFromEntries } from "./session-entries";

afterEach(() => {
  clearResults();
});

describe("web-access storage", () => {
  test("stores, retrieves, lists, and deletes results", () => {
    // Arrange
    const id = generateId();
    const data: StoredSearchData = {
      id,
      type: "search",
      timestamp: Date.now(),
      queries: [{ query: "test", answer: "answer", results: [], error: null, provider: "test" }],
    };

    // Act
    storeResult(id, data);

    // Assert
    expect(getResult(id)).toBe(data);
    expect(getAllResults()).toEqual([data]);
    expect(deleteResult(id)).toBe(true);
    expect(getResult(id)).toBeNull();
  });

  test("restores valid fresh custom entries from the current session branch", () => {
    // Arrange
    const now = Date.now();
    const fresh: StoredSearchData = {
      id: "fresh",
      type: "fetch",
      timestamp: now,
      urls: [{ url: "https://example.com", title: "Example", content: "Content", error: null, provider: "http" }],
    };
    const stale: StoredSearchData = {
      id: "stale",
      type: "fetch",
      timestamp: now - 2 * 60 * 60 * 1000,
      urls: [],
    };

    // Act
    restoreFromEntries(
      [
        { type: "custom", customType: "web-access-results", data: fresh },
        { type: "custom", customType: "web-access-results", data: stale },
        { type: "custom", customType: "other", data: { id: "ignored" } },
      ],
      now,
    );

    // Assert
    expect(getResult("fresh")).toEqual(fresh);
    expect(getResult("stale")).toBeNull();
    expect(getAllResults()).toHaveLength(1);
  });
});
