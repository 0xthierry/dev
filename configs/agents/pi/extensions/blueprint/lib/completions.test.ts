import { describe, expect, mock, test } from "bun:test";
import { buildBlueprintCompletionItems, getBlueprintArgumentCompletions } from "./completions";
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
    filePath: `/blueprints/${name}.json`,
    dir: "/blueprints",
    definition: { name, description: `${name} description`, start: "done", nodes: { done: { type: "final" } } },
  };
}
