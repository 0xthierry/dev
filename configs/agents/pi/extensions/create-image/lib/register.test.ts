import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { registerCreateImageCommand, registerCreateImageExtension } from "./register";
import type { CreateImageRuntime } from "./runtime";

function runtime(): CreateImageRuntime {
  return {
    providers: [
      {
        id: "nano-banana",
        aliases: [],
        label: "Nano Banana",
        generate: mock(async () => ({
          providerId: "nano-banana",
          providerLabel: "Nano Banana",
          images: [{ bytes: new Uint8Array([1]), mimeType: "image/jpeg", extension: "jpg" }],
        })),
      },
    ],
    saveImages: mock(async () => [
      { path: "/tmp/image.jpg", displayPath: "image.jpg", mimeType: "image/jpeg", bytes: 1 },
    ]),
    now: mock(() => new Date("2026-05-01T17:30:04Z")),
  };
}

describe("registerCreateImageExtension", () => {
  test("registers the create-image command", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerCreateImageExtension(fakePi.pi);

    // Assert
    expect(fakePi.commands.has("create-image")).toBe(true);
  });
});

describe("registerCreateImageCommand", () => {
  test("runs the registered command", async () => {
    // Arrange
    const fakePi = createFakePi();
    const fakeRuntime = runtime();
    registerCreateImageCommand(fakePi.pi, fakeRuntime);

    // Act
    await fakePi.runCommand("create-image", "a small icon");

    // Assert
    const provider = fakeRuntime.providers[0];
    expect(provider).toBeDefined();
    expect(provider?.generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "a small icon" }));
    expect(fakePi.sentMessages[0]?.message).toMatchObject({ content: expect.stringContaining("image.jpg") });
  });
});
