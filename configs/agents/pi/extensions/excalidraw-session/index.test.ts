import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import register from "./index";

describe("excalidraw-session entrypoint", () => {
  test("registers the extension", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    register(fakePi.pi);

    // Assert
    expect(fakePi.commands.has("excalidraw")).toBe(true);
    expect(fakePi.tools.has("excalidraw_canvas")).toBe(true);
  });
});
