import { describe, expect, test } from "bun:test";
import { saveGeneratedImages } from "./files";
import { createCreateImageRuntime } from "./runtime";

describe("createCreateImageRuntime", () => {
  test("wires production providers and file storage", () => {
    // Arrange / Act
    const runtime = createCreateImageRuntime();

    // Assert
    expect(runtime.providers.map((provider) => provider.id)).toEqual(["nano-banana"]);
    expect(runtime.saveImages).toBe(saveGeneratedImages);
    expect(runtime.now()).toBeInstanceOf(Date);
  });
});
