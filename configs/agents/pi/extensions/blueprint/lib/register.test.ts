import { describe, expect, mock, test } from "bun:test";
import type { AutocompleteProvider } from "@earendil-works/pi-tui";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { registerBlueprintCommand, registerBlueprintExtension } from "./register";
import { BLUEPRINT_DEPTH_ENV } from "./runner/pi-invocation";
import type { BlueprintRuntime } from "./runtime";
import type { LoadedBlueprint } from "./types";

describe("registerBlueprintExtension", () => {
  test("registers the blueprint command in the parent process", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerBlueprintExtension(fakePi.pi);

    // Assert
    expect(fakePi.commands.has("blueprint")).toBe(true);
  });

  test("does not register the blueprint command inside child blueprint Pi sessions", () => {
    // Arrange
    const fakePi = createFakePi();
    process.env[BLUEPRINT_DEPTH_ENV] = "1";

    try {
      // Act
      registerBlueprintExtension(fakePi.pi);

      // Assert
      expect(fakePi.commands.has("blueprint")).toBe(false);
    } finally {
      delete process.env[BLUEPRINT_DEPTH_ENV];
    }
  });
});

describe("registerBlueprintCommand", () => {
  test("registers the user-facing command with argument completions", () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime: BlueprintRuntime = {
      discoverBlueprints: mock(async () => ({ dirs: [], blueprints: [], errors: [] })),
      runBlueprint: mock(async () => {
        throw new Error("not used");
      }),
    };

    // Act
    registerBlueprintCommand(fakePi.pi, runtime);

    // Assert
    const command = fakePi.commands.get("blueprint");
    expect(command?.description).toContain("blueprint graph");
    expect(typeof command?.getArgumentCompletions).toBe("function");
  });

  test("registers a UI autocomplete provider for explicit tab completions", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/repo" });
    const runtime: BlueprintRuntime = {
      discoverBlueprints: mock(async () => ({ dirs: [], blueprints: [blueprint("project", "implement")], errors: [] })),
      runBlueprint: mock(async () => {
        throw new Error("not used");
      }),
    };
    registerBlueprintCommand(fakePi.pi, runtime);

    // Act
    await fakePi.emit("session_start", { reason: "startup" }, { hasUI: true });
    const baseProvider: AutocompleteProvider = {
      getSuggestions: async () => null,
      applyCompletion: (lines, cursorLine, cursorCol) => ({ lines, cursorLine, cursorCol }),
    };
    const provider = fakePi.autocompleteProviderFactories[0]?.(baseProvider);
    const line = "/blueprint pro";
    const suggestions = await provider?.getSuggestions([line], 0, line.length, {
      signal: new AbortController().signal,
      force: true,
    });

    // Assert
    expect(fakePi.autocompleteProviderFactories).toHaveLength(1);
    expect(suggestions).toMatchObject({
      prefix: "pro",
      items: [expect.objectContaining({ value: "project/implement" })],
    });
    expect(runtime.discoverBlueprints).toHaveBeenCalledWith("/repo");
  });
});

function blueprint(scope: "user" | "project", name: string): LoadedBlueprint {
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
