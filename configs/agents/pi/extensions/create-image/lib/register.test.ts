import { describe, expect, mock, test } from "bun:test";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
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
  test("registers argument completions for the command", () => {
    // Arrange
    const fakePi = createFakePi();
    const fakeRuntime = runtime();
    registerCreateImageCommand(fakePi.pi, fakeRuntime);

    // Act
    const command = fakePi.commands.get("create-image");
    const completions = command?.getArgumentCompletions?.("--provider n");

    // Assert
    expect(command?.getArgumentCompletions).toBeFunction();
    expect(completions).toEqual([expect.objectContaining({ value: "--provider nano-banana ", label: "nano-banana" })]);
  });

  test("registers a UI autocomplete provider for explicit tab completions", async () => {
    // Arrange
    const fakePi = createFakePi();
    const fakeRuntime = runtime();
    registerCreateImageCommand(fakePi.pi, fakeRuntime);

    // Act
    await fakePi.emit("session_start", { reason: "startup" }, { hasUI: true });
    const baseProvider: AutocompleteProvider = {
      getSuggestions: async () => null,
      applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
    };
    const provider = fakePi.autocompleteProviderFactories[0]?.(baseProvider);
    const line = "/create-image --provider n";
    const suggestions = await provider?.getSuggestions([line], 0, line.length, {
      signal: new AbortController().signal,
      force: true,
    });

    // Assert
    expect(fakePi.autocompleteProviderFactories).toHaveLength(1);
    expect(suggestions).toMatchObject({
      prefix: "--provider n",
      items: [expect.objectContaining({ value: "--provider nano-banana ", label: "nano-banana" })],
    });
  });

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
