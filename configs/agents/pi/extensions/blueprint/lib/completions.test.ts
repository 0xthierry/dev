import { describe, expect, mock, test } from "bun:test";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import {
  buildBlueprintCompletionItems,
  createBlueprintAutocompleteProvider,
  getBlueprintArgumentCompletions,
} from "./completions";
import type { BlueprintRuntime } from "./runtime";
import type { LoadedBlueprint } from "./types";

describe("buildBlueprintCompletionItems", () => {
  test("offers scoped ids and unique short names", () => {
    // Arrange
    const blueprints = [
      loadedBlueprint("user", "solo"),
      loadedBlueprint("user", "shared"),
      loadedBlueprint("project", "shared"),
    ];

    // Act
    const items = buildBlueprintCompletionItems(blueprints);

    // Assert
    expect(items.map((item) => item.value)).toEqual(["list", "project/shared", "solo", "user/shared", "user/solo"]);
  });
});

describe("createBlueprintAutocompleteProvider", () => {
  test("handles forced tab completion in blueprint command arguments", async () => {
    // Arrange
    const baseProvider: AutocompleteProvider = {
      getSuggestions: mock(async () => null),
      applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
    };
    const runtime = fakeRuntime([loadedBlueprint("project", "implement")]);
    const provider = createBlueprintAutocompleteProvider(baseProvider, runtime, "/repo");
    const line = "/blueprint pro";

    // Act
    const suggestions = await provider.getSuggestions([line], 0, line.length, {
      signal: new AbortController().signal,
      force: true,
    });

    // Assert
    expect(suggestions).toMatchObject({
      prefix: "pro",
      items: [expect.objectContaining({ value: "project/implement" })],
    });
    expect(baseProvider.getSuggestions).not.toHaveBeenCalled();
  });

  test("delegates autocomplete outside blueprint command arguments", async () => {
    // Arrange
    const baseProvider: AutocompleteProvider = {
      getSuggestions: mock(async () => ({ prefix: "", items: [{ value: "/other", label: "/other" }] })),
      applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
    };
    const runtime = fakeRuntime([loadedBlueprint("project", "implement")]);
    const provider = createBlueprintAutocompleteProvider(baseProvider, runtime, "/repo");
    const line = "/other pro";

    // Act
    const suggestions = await provider.getSuggestions([line], 0, line.length, {
      signal: new AbortController().signal,
      force: true,
    });

    // Assert
    expect(suggestions).toMatchObject({ prefix: "", items: [{ value: "/other", label: "/other" }] });
    expect(runtime.discoverBlueprints).not.toHaveBeenCalled();
  });
});

describe("getBlueprintArgumentCompletions", () => {
  test("filters the first blueprint argument", async () => {
    // Arrange
    const runtime = fakeRuntime([loadedBlueprint("project", "implement"), loadedBlueprint("user", "review")]);

    // Act
    const completions = await getBlueprintArgumentCompletions(runtime, "/repo", "pro");

    // Assert
    expect(completions?.map((item) => item.value)).toEqual(["project/implement"]);
    expect(runtime.discoverBlueprints).toHaveBeenCalledWith("/repo");
  });

  test("does not complete after the task portion starts", async () => {
    // Arrange
    const runtime = fakeRuntime([loadedBlueprint("project", "implement")]);

    // Act
    const completions = await getBlueprintArgumentCompletions(runtime, "/repo", "implement add");

    // Assert
    expect(completions).toBeNull();
    expect(runtime.discoverBlueprints).not.toHaveBeenCalled();
  });
});

function fakeRuntime(blueprints: LoadedBlueprint[]): BlueprintRuntime {
  return {
    discoverBlueprints: mock(async () => ({ dirs: ["/blueprints"], blueprints, errors: [] })),
    runBlueprint: mock(async () => {
      throw new Error("not used");
    }),
  };
}

function loadedBlueprint(scope: LoadedBlueprint["scope"], name: string): LoadedBlueprint {
  return {
    id: `${scope}/${name}`,
    name,
    description: `${name} description`,
    scope,
    filePath: `/blueprints/${name}.jsonc`,
    dir: "/blueprints",
    definition: { name, description: `${name} description`, start: "done", nodes: { done: { type: "stop" } } },
  };
}
