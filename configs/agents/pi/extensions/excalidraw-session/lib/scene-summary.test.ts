import { describe, expect, test } from "bun:test";
import { summarizeCapture, summarizeMutation, summarizeScene, summarizeStatus } from "./scene-summary";

describe("summarizeStatus", () => {
  test("formats connected tabs", () => {
    // Arrange
    const status = {
      running: true,
      activeTabId: "tab-1",
      clients: [
        {
          tabId: "tab-1",
          title: "Architecture",
          url: "http://excalidraw.localhost/",
          focused: true,
          visible: true,
          apiReady: true,
          elementCount: 3,
        },
      ],
    };

    // Act
    const summary = summarizeStatus(status);

    // Assert
    expect(summary).toContain("Excalidraw bridge is running.");
    expect(summary).toContain("Connected tabs: 1.");
    expect(summary).toContain("tab-1: Architecture");
  });
});

describe("summarizeScene", () => {
  test("summarizes viewport, selected IDs, and truncates elements", () => {
    // Arrange
    const scene = {
      scene: {
        selectedElementIds: { a: true, b: false },
        elements: [
          { id: "a", type: "text", x: 1, y: 2, width: 10, height: 20, text: "hello" },
          { id: "b", type: "rectangle", x: 3, y: 4, width: 30, height: 40 },
        ],
      },
      viewport: { width: 800, height: 600, scrollX: -10, scrollY: 20, zoom: { value: 1.25 } },
    };

    // Act
    const summary = summarizeScene(scene, { elementLimit: 1 });

    // Assert
    expect(summary).toContain("Scene elements: 2.");
    expect(summary).toContain("Selected elements: a.");
    expect(summary).toContain("Viewport: 800×600, zoom 1.25, scroll -10, 20.");
    expect(summary).toContain('text a at (1, 2) size 10×20 text="hello"');
    expect(summary).toContain("… 1 more element(s) omitted");
    expect(summary).toContain("call get_scene with elementIds");
  });

  test("includes exact JSON for requested elements", () => {
    // Arrange
    const scene = {
      scene: {
        selectedElementIds: {},
        elements: [
          { id: "one", type: "rectangle", strokeColor: "#1e1e1e" },
          { id: "two", type: "text", text: "hello", containerId: "one" },
        ],
      },
      viewport: {},
    };

    // Act
    const summary = summarizeScene(scene, { elementIds: ["two"] });

    // Assert
    expect(summary).toContain("Requested element JSON (1 match(es))");
    expect(summary).toContain('"id": "two"');
    expect(summary).toContain('"containerId": "one"');
    expect(summary).not.toContain('"id": "one"');
  });
});

describe("summarizeCapture", () => {
  test("describes PNG capture size", () => {
    // Arrange
    const capture = { data: "abc123" };

    // Act
    const summary = summarizeCapture(capture);

    // Assert
    expect(summary).toContain("Captured current Excalidraw canvas viewport as PNG");
    expect(summary).toContain("6 base64 character(s)");
  });
});

describe("summarizeMutation", () => {
  test("includes element count when available", () => {
    // Arrange
    const result = { elementCount: 4 };

    // Act
    const summary = summarizeMutation("update_scene", result);

    // Assert
    expect(summary).toBe("update_scene succeeded. Canvas now has 4 element(s).");
  });
});
