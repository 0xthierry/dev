import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { registerTaskTitleExtension } from "./register";

describe("registerTaskTitleExtension", () => {
  test("sets the terminal title for interactive prompts", async () => {
    // Arrange
    const fake = createFakePi();
    const setTitle = mock(() => undefined);
    registerTaskTitleExtension(fake.pi);

    // Act
    const results = await fake.emit(
      "input",
      { type: "input", text: "Fix the grouped tab title", source: "interactive" },
      { hasUI: true, ui: { setTitle } },
    );

    // Assert
    expect(setTitle).toHaveBeenCalledWith("π · Fix the grouped tab title");
    expect(results).toEqual([{ action: "continue" }]);
  });

  test("waits until a queued follow-up becomes active", async () => {
    // Arrange
    const fake = createFakePi();
    const setTitle = mock(() => undefined);
    const ctx = { hasUI: true, ui: { setTitle } };
    registerTaskTitleExtension(fake.pi);

    // Act
    await fake.emit(
      "input",
      { type: "input", text: "Run the next validation", source: "interactive", streamingBehavior: "followUp" },
      ctx,
    );
    const callsWhileQueued = setTitle.mock.calls.length;
    await fake.emit("before_agent_start", { type: "before_agent_start", prompt: "expanded prompt" }, ctx);

    // Assert
    expect(callsWhileQueued).toBe(0);
    expect(setTitle).toHaveBeenCalledWith("π · Run the next validation");
  });

  test("ignores extension-injected wake messages", async () => {
    // Arrange
    const fake = createFakePi();
    const setTitle = mock(() => undefined);
    registerTaskTitleExtension(fake.pi);

    // Act
    await fake.emit(
      "input",
      { type: "input", text: "Check your AMQ inbox", source: "extension" },
      { hasUI: true, ui: { setTitle } },
    );

    // Assert
    expect(setTitle).not.toHaveBeenCalled();
  });

  test("does not emit titles when Pi has no UI", async () => {
    // Arrange
    const fake = createFakePi();
    const setTitle = mock(() => undefined);
    registerTaskTitleExtension(fake.pi);

    // Act
    await fake.emit(
      "input",
      { type: "input", text: "Print-only task", source: "interactive" },
      { hasUI: false, ui: { setTitle } },
    );

    // Assert
    expect(setTitle).not.toHaveBeenCalled();
  });
});
