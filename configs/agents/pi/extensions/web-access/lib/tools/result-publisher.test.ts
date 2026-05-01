import { afterEach, describe, expect, test } from "bun:test";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import { clearResults, getResult } from "../storage/result-store";
import type { StoredSearchData } from "../types";
import { storeAndPublish } from "./result-publisher";

afterEach(() => {
  clearResults();
});

describe("storeAndPublish", () => {
  test("stores the result and appends a Pi session entry", () => {
    // Arrange
    const fake = createFakePi();
    const data: StoredSearchData = {
      id: "result-id",
      type: "search",
      timestamp: 1,
      queries: [{ query: "q", answer: "a", results: [], error: null }],
    };

    // Act
    storeAndPublish(fake.pi, data);

    // Assert
    expect(getResult("result-id")).toBe(data);
    expect(fake.appendedEntries).toEqual([{ customType: "web-access-results", data }]);
  });
});
