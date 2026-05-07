import { describe, expect, mock, test } from "bun:test";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { formatCreateImageResult, handleCreateImageCommand } from "./command";
import type { CreateImageRuntime } from "./runtime";

function context(overrides: Partial<ExtensionCommandContext> = {}): ExtensionCommandContext {
  const defaultUi = { notify: mock(() => undefined), editor: mock(async () => undefined) };
  return {
    cwd: "/tmp/project",
    hasUI: false,
    signal: undefined,
    ...overrides,
    ui: { ...defaultUi, ...(overrides.ui as object | undefined) },
  } as unknown as ExtensionCommandContext;
}

function runtime(): CreateImageRuntime {
  return {
    providers: [
      {
        id: "nano-banana",
        aliases: ["gemini"],
        label: "Nano Banana",
        generate: mock(async () => ({
          providerId: "nano-banana",
          providerLabel: "Nano Banana",
          images: [{ bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg", extension: "jpg" }],
        })),
      },
    ],
    saveImages: mock(async () => [
      {
        path: "/tmp/project/generated/image.jpg",
        displayPath: "generated/image.jpg",
        mimeType: "image/jpeg",
        bytes: 3,
      },
    ]),
    now: mock(() => new Date("2026-05-01T17:30:04Z")),
  };
}

describe("handleCreateImageCommand", () => {
  test("generates, saves, and publishes image results", async () => {
    // Arrange
    const fakePi = createFakePi();
    const fakeRuntime = runtime();

    // Act
    await handleCreateImageCommand(fakePi.pi, fakeRuntime, "--provider gemini --out assets a tiny fox logo", context());

    // Assert
    const provider = fakeRuntime.providers[0];
    expect(provider).toBeDefined();
    expect(provider?.generate).toHaveBeenCalledWith({
      prompt: "a tiny fox logo",
      profile: undefined,
      signal: undefined,
    });
    expect(fakeRuntime.saveImages).toHaveBeenCalledWith(expect.any(Array), {
      cwd: "/tmp/project",
      outputDir: "assets",
      fileName: undefined,
      prompt: "a tiny fox logo",
      providerId: "nano-banana",
      now: new Date("2026-05-01T17:30:04Z"),
    });
    expect(fakePi.sentMessages[0]?.message).toMatchObject({
      customType: "create-image-result",
      display: true,
      content: expect.stringContaining("generated/image.jpg"),
    });
  });

  test("prompts interactively when no prompt is supplied and UI is available", async () => {
    // Arrange
    const fakePi = createFakePi();
    const fakeRuntime = runtime();
    const editor = mock(async () => "an orange robot");

    // Act
    await handleCreateImageCommand(fakePi.pi, fakeRuntime, "", context({ hasUI: true, ui: { editor } } as never));

    // Assert
    expect(editor).toHaveBeenCalledWith("Create image prompt", "generate an image of ");
    const provider = fakeRuntime.providers[0];
    expect(provider).toBeDefined();
    expect(provider?.generate).toHaveBeenCalledWith(expect.objectContaining({ prompt: "an orange robot" }));
  });

  test("publishes usage for missing prompts in non-interactive contexts", async () => {
    // Arrange
    const fakePi = createFakePi();
    const fakeRuntime = runtime();

    // Act
    await handleCreateImageCommand(fakePi.pi, fakeRuntime, "", context());

    // Assert
    const provider = fakeRuntime.providers[0];
    expect(provider).toBeDefined();
    expect(provider?.generate).not.toHaveBeenCalled();
    expect(fakePi.sentMessages[0]?.message).toMatchObject({ content: expect.stringContaining("Missing image prompt") });
  });
});

describe("formatCreateImageResult", () => {
  test("formats saved images for display", () => {
    // Arrange
    const result = { providerId: "nano-banana", providerLabel: "Nano Banana", images: [] };
    const saved = [{ path: "/tmp/image.jpg", displayPath: "image.jpg", mimeType: "image/jpeg", bytes: 10 }];

    // Act
    const text = formatCreateImageResult(result, saved);

    // Assert
    expect(text).toContain("Created 1 image(s) with Nano Banana.");
    expect(text).toContain("image.jpg (image/jpeg, 10 bytes)");
  });
});
