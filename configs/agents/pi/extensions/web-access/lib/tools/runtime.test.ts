import { describe, expect, test } from "bun:test";
import { fetchAllContent } from "../content/pipeline";
import { search } from "../search/orchestrator";
import { generateId } from "../storage/result-store";
import { createWebAccessRuntime } from "./runtime";

describe("createWebAccessRuntime", () => {
  test("returns the production implementations", () => {
    // Arrange
    const expected = { search, fetchAllContent, generateId };

    // Act
    const runtime = createWebAccessRuntime();

    // Assert
    expect(runtime.search).toBe(expected.search);
    expect(runtime.fetchAllContent).toBe(expected.fetchAllContent);
    expect(runtime.generateId).toBe(expected.generateId);
  });
});
