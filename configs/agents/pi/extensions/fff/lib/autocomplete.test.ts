import { describe, expect, mock, test } from "bun:test";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import {
  buildAtCompletionValue,
  createFffAutocompleteProviderFactory,
  createFffMentionProvider,
  extractAtPrefix,
} from "./autocomplete";
import type { MixedItem } from "./types";

describe("extractAtPrefix", () => {
  test("extracts unquoted and quoted @ prefixes", () => {
    // Arrange
    const inputs = ["open @src", 'open @"src/with space'];

    // Act
    const results = inputs.map(extractAtPrefix);

    // Assert
    expect(results).toEqual(["@src", '@"src/with space']);
  });

  test("ignores @ that is not the active word", () => {
    // Arrange
    const input = "email a@b.com then";

    // Act
    const result = extractAtPrefix(input);

    // Assert
    expect(result).toBeNull();
  });
});

describe("buildAtCompletionValue", () => {
  test("quotes paths with spaces", () => {
    // Arrange
    const paths = ["src/index.ts", "src/with space.ts"];

    // Act
    const results = paths.map(buildAtCompletionValue);

    // Assert
    expect(results).toEqual(["@src/index.ts", '@"src/with space.ts"']);
  });
});

describe("createFffMentionProvider", () => {
  test("returns FFF-backed mention suggestions", async () => {
    // Arrange
    const search = mock(
      async (): Promise<MixedItem[]> => [
        {
          type: "file",
          item: {
            relativePath: "src/index.ts",
            fileName: "index.ts",
            size: 1,
            modified: 1,
            accessFrecencyScore: 0,
            modificationFrecencyScore: 0,
            totalFrecencyScore: 0,
            gitStatus: "clean",
          },
        },
        { type: "directory", item: { relativePath: "src/components/", dirName: "components/", maxAccessFrecency: 0 } },
      ],
    );
    const provider = createFffMentionProvider(search);

    // Act
    const result = await provider.getSuggestions(["open @src"], 0, 9, abortOptions());

    // Assert
    expect(search).toHaveBeenCalledWith("src", expect.any(AbortSignal));
    expect(result).toEqual({
      prefix: "@src",
      items: [
        { value: "@src/index.ts", label: "index.ts", description: "src/index.ts" },
        { value: "@src/components/", label: "components/", description: "src/components/" },
      ],
    });
  });

  test("applies completions by replacing the active prefix", () => {
    // Arrange
    const provider = createFffMentionProvider(mock(async () => []));

    // Act
    const result = provider.applyCompletion(
      ["open @src now"],
      0,
      9,
      { value: "@src/index.ts", label: "index.ts" },
      "@src",
    );

    // Assert
    expect(result).toEqual({ lines: ["open @src/index.ts now"], cursorLine: 0, cursorCol: 18 });
  });
});

describe("createFffAutocompleteProviderFactory", () => {
  test("delegates non-mention completions to the current provider", async () => {
    // Arrange
    const search = mock(async () => []);
    const current = createCurrentProvider();
    const provider = createFffAutocompleteProviderFactory(search)(current);

    // Act
    const result = await provider.getSuggestions(["hello"], 0, 5, abortOptions());

    // Assert
    expect(result).toEqual({ items: [{ value: "base", label: "base" }], prefix: "ba" });
    expect(current.getSuggestions).toHaveBeenCalledTimes(1);
    expect(search).not.toHaveBeenCalled();
  });

  test("delegates when FFF lookup fails", async () => {
    // Arrange
    const search = mock(async () => {
      throw new Error("not ready");
    });
    const current = createCurrentProvider();
    const provider = createFffAutocompleteProviderFactory(search)(current);

    // Act
    const result = await provider.getSuggestions(["@src"], 0, 4, abortOptions());

    // Assert
    expect(result).toEqual({ items: [{ value: "base", label: "base" }], prefix: "ba" });
    expect(current.getSuggestions).toHaveBeenCalledTimes(1);
  });
});

function abortOptions() {
  return { signal: new AbortController().signal };
}

function createCurrentProvider(): AutocompleteProvider {
  return {
    getSuggestions: mock(async () => ({ items: [{ value: "base", label: "base" }], prefix: "ba" })),
    applyCompletion: mock(() => ({ lines: ["applied"], cursorLine: 0, cursorCol: 7 })),
    shouldTriggerFileCompletion: mock(() => false),
  };
}
