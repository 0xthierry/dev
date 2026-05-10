import { describe, expect, mock, test } from "bun:test";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { handleBlueprintCommand } from "./command";
import { BLUEPRINT_PROGRESS_MESSAGE_TYPE } from "./progress-message";
import type { BlueprintRuntime } from "./runtime";
import type { BlueprintDiscoveryResult, BlueprintRunResult, LoadedBlueprint } from "./types";

describe("handleBlueprintCommand", () => {
  test("lists discovered blueprints", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = fakeRuntime(discoveryResult([loadedBlueprint("user", "flow")]));

    // Act
    await handleBlueprintCommand(fakePi.pi, runtime, "", fakePi.createContext() as unknown as ExtensionCommandContext);

    // Assert
    expect(fakePi.uiNotifications).toEqual([{ message: expect.stringContaining("user/flow"), type: "info" }]);
    expect(runtime.runBlueprint).not.toHaveBeenCalled();
  });

  test("runs the selected blueprint and reports the summary", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/repo" });
    const blueprint = loadedBlueprint("project", "flow");
    const runtime = fakeRuntime(discoveryResult([blueprint]));

    // Act
    await handleBlueprintCommand(
      fakePi.pi,
      runtime,
      "project/flow add feature",
      fakePi.createContext({ model: { provider: "anthropic", id: "sonnet" } }) as unknown as ExtensionCommandContext,
    );

    // Assert
    expect(runtime.runBlueprint).toHaveBeenCalledWith(
      expect.objectContaining({ blueprint, task: "add feature", cwd: "/repo", modelRef: "anthropic/sonnet" }),
      expect.any(Function),
    );
    expect(fakePi.sentMessages).toEqual([
      {
        message: expect.objectContaining({
          customType: BLUEPRINT_PROGRESS_MESSAGE_TYPE,
          content: expect.stringContaining("live progress card"),
          display: true,
          details: expect.objectContaining({ ephemeral: true, superseded: true }),
        }),
        options: undefined,
      },
      {
        message: expect.objectContaining({
          customType: BLUEPRINT_PROGRESS_MESSAGE_TYPE,
          display: true,
          details: expect.objectContaining({ progress: expect.objectContaining({ status: "succeeded" }) }),
        }),
        options: undefined,
      },
    ]);
    expect(fakePi.uiNotifications).toEqual([]);
  });

  test("reports unknown blueprint selections", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime = fakeRuntime(discoveryResult([loadedBlueprint("user", "flow")]));

    // Act
    await handleBlueprintCommand(
      fakePi.pi,
      runtime,
      "missing task",
      fakePi.createContext() as unknown as ExtensionCommandContext,
    );

    // Assert
    expect(fakePi.uiNotifications).toEqual([
      { message: "Unknown blueprint 'missing'. Available blueprints: user/flow.", type: "error" },
    ]);
    expect(runtime.runBlueprint).not.toHaveBeenCalled();
  });
});

function fakeRuntime(discovery: BlueprintDiscoveryResult): BlueprintRuntime {
  return {
    discoverBlueprints: mock(async () => discovery),
    runBlueprint: mock(async (request, onProgress) => {
      onProgress?.({
        runId: "run-1",
        runDir: "/runs/run-1",
        status: "running",
        currentNodeId: "done",
        message: "Running done.",
        results: [],
      });
      return runResult(request.blueprint.id, request.task);
    }),
  };
}

function discoveryResult(blueprints: LoadedBlueprint[]): BlueprintDiscoveryResult {
  return { dirs: ["/blueprints"], blueprints, errors: [] };
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

function runResult(blueprint: string, task: string): BlueprintRunResult {
  return {
    runId: "run-1",
    runDir: "/runs/run-1",
    contextFile: "/runs/run-1/context.md",
    blueprint,
    task,
    status: "succeeded",
    message: "done",
    results: [],
  };
}
