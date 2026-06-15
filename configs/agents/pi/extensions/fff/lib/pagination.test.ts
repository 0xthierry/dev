import { describe, expect, test } from "bun:test";
import { createCursorStore } from "./pagination";
import type { GrepCursor } from "./types";

describe("createCursorStore", () => {
  test("stores and retrieves grep cursors by opaque id", () => {
    // Arrange
    const store = createCursorStore();
    const cursor = { __brand: "GrepCursor", _offset: 5 } as GrepCursor;

    // Act
    const id = store.storeGrep(cursor);
    const result = store.getGrep(id);

    // Assert
    expect(id).toBe("fff_g1");
    expect(result).toBe(cursor);
  });

  test("evicts oldest cursors when full", () => {
    // Arrange
    const store = createCursorStore(1);
    const first = { __brand: "GrepCursor", _offset: 1 } as GrepCursor;
    const second = { __brand: "GrepCursor", _offset: 2 } as GrepCursor;

    // Act
    const firstId = store.storeGrep(first);
    const secondId = store.storeGrep(second);

    // Assert
    expect(store.getGrep(firstId)).toBeUndefined();
    expect(store.getGrep(secondId)).toBe(second);
  });

  test("stores find pagination state", () => {
    // Arrange
    const store = createCursorStore();
    const cursor = { query: "src/ needle", pattern: "needle", pageSize: 10, nextPageIndex: 1 };

    // Act
    const id = store.storeFind(cursor);
    const result = store.getFind(id);

    // Assert
    expect(id).toBe("fff_f1");
    expect(result).toEqual(cursor);
  });
});
