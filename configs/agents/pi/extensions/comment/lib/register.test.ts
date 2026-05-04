import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { registerCommentCommand, registerCommentExtension } from "./register";
import type { CommentRuntime } from "./runtime";

describe("registerCommentExtension", () => {
  test("registers the comment command", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerCommentExtension(fakePi.pi);

    // Assert
    expect(fakePi.commands.has("comment")).toBe(true);
  });
});

describe("registerCommentCommand", () => {
  test("wires the command to the provided runtime", async () => {
    // Arrange
    const fakePi = createFakePi();
    const runtime: CommentRuntime = {
      editText: mock(async (text: string) => `edited: ${text}`),
    };
    registerCommentCommand(fakePi.pi, runtime);

    // Act
    await fakePi.runCommand("comment", "", {
      hasUI: true,
      sessionManager: { getBranch: () => [] },
      ui: { notify: mock(() => undefined), setEditorText: mock(() => undefined) },
    });

    // Assert
    expect(fakePi.commands.get("comment")?.description).toContain("last assistant message");
    expect(runtime.editText).not.toHaveBeenCalled();
  });
});
