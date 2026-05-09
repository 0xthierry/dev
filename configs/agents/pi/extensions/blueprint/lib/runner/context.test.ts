import { describe, expect, mock, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LoadedBlueprint } from "../types";
import { hydrateBlueprintContext } from "./context";

describe("hydrateBlueprintContext", () => {
  test("renders task, git status, and package scripts", async () => {
    // Arrange
    const dir = await mkdtemp(join(tmpdir(), "pi-blueprint-context-"));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "bun test", lint: "biome check" } }),
      "utf8",
    );
    const runCommand = mock(async () => ({ stdout: " M file.ts\n", stderr: "", exitCode: 0 }));

    try {
      // Act
      const context = await hydrateBlueprintContext(loadedBlueprint("implement"), dir, "add feature", { runCommand });

      // Assert
      expect(context).toContain("Blueprint: user/implement");
      expect(context).toContain("add feature");
      expect(context).toContain("M file.ts");
      expect(context).toContain("- test: bun test");
      expect(runCommand).toHaveBeenCalledWith("git status --short");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function loadedBlueprint(name: string): LoadedBlueprint {
  return {
    id: `user/${name}`,
    name,
    description: `${name} description`,
    scope: "user",
    filePath: `/blueprints/${name}.json`,
    dir: "/blueprints",
    definition: { name, description: `${name} description`, start: "done", nodes: { done: { type: "final" } } },
  };
}
