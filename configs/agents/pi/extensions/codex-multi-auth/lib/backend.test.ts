import { describe, expect, test } from "bun:test";
import { createCodexMultiAuthBackend, reserveLoopbackPort } from "./backend";

describe("createCodexMultiAuthBackend", () => {
  test("loads the pinned package runtime boundaries", async () => {
    // Arrange
    const expectedMethods = ["loadAccountManager", "reserveLoopbackPort", "startRuntimeProxy", "startLocalBridge"];

    // Act
    const backend = await createCodexMultiAuthBackend();

    // Assert
    expect(expectedMethods.every((method) => typeof backend[method as keyof typeof backend] === "function")).toBe(true);
  });
});

describe("reserveLoopbackPort", () => {
  test("returns an available TCP port", async () => {
    // Arrange
    const minimumDynamicPort = 1;

    // Act
    const port = await reserveLoopbackPort();

    // Assert
    expect(port).toBeGreaterThanOrEqual(minimumDynamicPort);
    expect(port).toBeLessThanOrEqual(65_535);
  });
});
