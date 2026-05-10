import { describe, expect, test } from "bun:test";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { createFakePi } from "../../_shared/testing/fake-pi";
import {
  BLUEPRINT_PROGRESS_MESSAGE_TYPE,
  blueprintProgressMessage,
  createBlueprintProgressMessageHandle,
  formatBlueprintProgressMessageLines,
  renderBlueprintProgressMessage,
} from "./progress-message";
import type { BlueprintRunProgress, LoadedBlueprint } from "./types";

describe("blueprintProgressMessage", () => {
  test("builds a visible custom message with compact content and detailed workflow data", () => {
    // Arrange
    const blueprint = loadedBlueprint();
    const progress = runningProgress();

    // Act
    const message = blueprintProgressMessage(blueprint, "add auth", progress);

    // Assert
    expect(message).toMatchObject({
      customType: BLUEPRINT_PROGRESS_MESSAGE_TYPE,
      content: "Blueprint project/flow running: Running lint (command).",
      display: true,
      details: { blueprint: { id: "project/flow" }, task: "add auth", progress: { currentNodeId: "lint" } },
    });
    expect(message.details.progress.results).not.toBe(progress.results);
  });

  test("keeps one live message details object updated for repainting", () => {
    // Arrange
    const fakePi = createFakePi();
    const handle = createBlueprintProgressMessageHandle(fakePi.pi, loadedBlueprint(), "add auth", runningProgress());
    const finalProgress = { ...runningProgress(), status: "succeeded" as const, message: "done" };

    // Act
    handle.publish();
    handle.update(finalProgress);

    // Assert
    expect(fakePi.sentMessages).toHaveLength(1);
    expect(handle.details.progress.status).toBe("succeeded");
    expect(
      (fakePi.sentMessages[0].message as { details: { progress: { status: string } } }).details.progress.status,
    ).toBe("succeeded");
  });

  test("hides a superseded live card after the final persisted card is sent", () => {
    // Arrange
    const fakePi = createFakePi();
    const handle = createBlueprintProgressMessageHandle(fakePi.pi, loadedBlueprint(), "add auth", runningProgress());
    handle.publish();
    const liveMessage = fakePi.sentMessages[0].message as Parameters<typeof renderBlueprintProgressMessage>[0];
    const component = renderBlueprintProgressMessage(liveMessage, { expanded: false }, plainTheme());

    // Act
    const runningText = component?.render(120).join("\n");
    handle.finish({ ...runningProgress(), status: "succeeded", message: "done" });
    const finishedText = component?.render(120).join("\n");

    // Assert
    expect(runningText).toContain("Blueprint project/flow");
    expect(finishedText).toBe("");
  });
});

describe("formatBlueprintProgressMessageLines", () => {
  test("formats a collapsed transcript card with node statuses", () => {
    // Arrange
    const details = { blueprint: loadedBlueprint(), task: "add auth", progress: runningProgress() };

    // Act
    const lines = formatBlueprintProgressMessageLines(details);
    const text = lines.join("\n");

    // Assert
    expect(text).toContain("⏳ Blueprint project/flow — running");
    expect(text).toContain("2/4 done · lint running · 1 queued");
    expect(text).toContain("✓ context [pi] succeeded attempt 1");
    expect(text).toContain("⏳ lint [command] running attempt 1 — bun run lint");
    expect(text).toContain("Artifacts: /runs/run-1");
  });

  test("includes live child Pi assistant and tool activity", () => {
    // Arrange
    const progress: BlueprintRunProgress = {
      ...runningProgress(),
      currentNodeId: "implement",
      message: "Running implement (pi).",
      activeNode: {
        nodeId: "implement",
        type: "pi",
        attempt: 1,
        activity: [
          { kind: "assistant", status: "running", text: "I am editing the implementation." },
          {
            kind: "tool",
            toolCallId: "tool-1",
            toolName: "bash",
            status: "running",
            argsPreview: "$ bun test",
          },
        ],
      },
    };
    const details = { blueprint: loadedBlueprint(), task: "add auth", progress };

    // Act
    const text = formatBlueprintProgressMessageLines(details).join("\n");

    // Assert
    expect(text).toContain("⏳ implement [pi] running attempt 1");
    expect(text).toContain("assistant: I am editing the implementation.");
    expect(text).toContain("↻ bash $ bun test");
  });
});

function loadedBlueprint(): LoadedBlueprint {
  return {
    id: "project/flow",
    name: "flow",
    description: "Flow description",
    scope: "project",
    filePath: "/repo/.pi/blueprint/flow.jsonc",
    dir: "/repo/.pi/blueprint",
    definition: {
      name: "flow",
      description: "Flow description",
      start: "context",
      nodes: {
        context: { type: "pi", prompt: "context", next: "implement" },
        implement: { type: "pi", prompt: "implement", next: "lint" },
        lint: { type: "command", run: "bun run lint", next: "done" },
        done: { type: "stop", message: "done" },
      },
    },
  };
}

function runningProgress(): BlueprintRunProgress {
  return {
    runId: "run-1",
    runDir: "/runs/run-1",
    status: "running",
    currentNodeId: "lint",
    message: "Running lint (command).",
    results: [
      {
        nodeId: "context",
        type: "pi",
        attempt: 1,
        status: "success",
        output: "context done",
        startedAt: "start",
        finishedAt: "finish",
      },
      {
        nodeId: "implement",
        type: "pi",
        attempt: 1,
        status: "success",
        output: "implementation done",
        startedAt: "start",
        finishedAt: "finish",
      },
    ],
  };
}

function plainTheme(): Theme {
  return {
    bg: (_name: string, text: string) => text,
    fg: (_name: string, text: string) => text,
    bold: (text: string) => text,
    italic: (text: string) => text,
    strikethrough: (text: string) => text,
  } as Theme;
}
