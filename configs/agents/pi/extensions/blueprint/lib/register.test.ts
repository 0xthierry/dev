import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { registerBlueprintCommand, registerBlueprintExtension } from "./register";
import { BLUEPRINT_DEPTH_ENV } from "./runner/pi-invocation";
import type { BlueprintRuntime } from "./runtime";

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
});
