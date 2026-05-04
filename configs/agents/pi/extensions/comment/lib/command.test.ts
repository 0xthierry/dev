import { describe, expect, mock, test } from "bun:test";
import type { AssistantMessage, StopReason, UserMessage } from "@mariozechner/pi-ai";
import type { ExtensionCommandContext, ExtensionUIContext, SessionEntry } from "@mariozechner/pi-coding-agent";
import { formatLastAssistantTextError, handleCommentCommand } from "./command";
import type { CommentRuntime } from "./runtime";

describe("handleCommentCommand", () => {
  test("loads edited quoted assistant text into the editor", async () => {
    // Arrange
    const runtime = createRuntime("edited comment");
    const { ctx, ui, waitForIdle } = createCommandContext([messageEntry(assistantMessage("Assistant says hi."))]);

    // Act
    await handleCommentCommand(runtime, ctx);

    // Assert
    expect(waitForIdle).toHaveBeenCalledTimes(1);
    expect(runtime.editText).toHaveBeenCalledWith("> Assistant says hi.");
    expect(ui.setEditorText).toHaveBeenCalledWith("edited comment");
    expect(ui.notify).toHaveBeenCalledWith("Loaded edited quoted assistant text into the editor.", "info");
  });

  test("does nothing when UI is unavailable", async () => {
    // Arrange
    const runtime = createRuntime("edited comment");
    const { ctx, ui, waitForIdle } = createCommandContext(
      [messageEntry(assistantMessage("Assistant says hi."))],
      false,
    );

    // Act
    await handleCommentCommand(runtime, ctx);

    // Assert
    expect(waitForIdle).not.toHaveBeenCalled();
    expect(runtime.editText).not.toHaveBeenCalled();
    expect(ui.notify).not.toHaveBeenCalled();
  });

  test("reports when there is no completed assistant text", async () => {
    // Arrange
    const runtime = createRuntime("edited comment");
    const { ctx, ui } = createCommandContext([messageEntry(userMessage("hello"))]);

    // Act
    await handleCommentCommand(runtime, ctx);

    // Assert
    expect(runtime.editText).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith("No assistant message found on the current branch.", "error");
  });

  test("reports external editor failures", async () => {
    // Arrange
    const runtime = createRuntime(new Error("editor failed"));
    const { ctx, ui } = createCommandContext([messageEntry(assistantMessage("Assistant says hi."))]);

    // Act
    await handleCommentCommand(runtime, ctx);

    // Assert
    expect(ui.setEditorText).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith("editor failed", "error");
  });
});

describe("formatLastAssistantTextError", () => {
  test("formats incomplete assistant message errors", () => {
    // Arrange
    const result = {
      ok: false as const,
      reason: "incompleteAssistantMessage" as const,
      stopReason: "toolUse" as const,
    };

    // Act
    const message = formatLastAssistantTextError(result);

    // Assert
    expect(message).toBe("Last assistant message is incomplete (toolUse).");
  });
});

function createRuntime(result: string | Error): CommentRuntime {
  return {
    editText: mock(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

function createCommandContext(branch: SessionEntry[], hasUI = true) {
  const ui = createUi();
  const waitForIdle = mock(async () => undefined);
  const ctx: ExtensionCommandContext = {
    ui,
    hasUI,
    cwd: "/tmp/project",
    sessionManager: {
      getBranch: mock(() => branch),
      getCwd: mock(() => "/tmp/project"),
      getSessionDir: mock(() => "/tmp/sessions"),
      getSessionId: mock(() => "session-id"),
      getSessionFile: mock(() => undefined),
      getLeafId: mock(() => null),
      getLeafEntry: mock(() => undefined),
      getEntry: mock(() => undefined),
      getLabel: mock(() => undefined),
      getHeader: mock(() => ({
        type: "session" as const,
        id: "session-id",
        timestamp: new Date(0).toISOString(),
        cwd: "/tmp/project",
      })),
      getEntries: mock(() => branch),
      getTree: mock(() => []),
      getSessionName: mock(() => undefined),
    },
    modelRegistry: undefined as never,
    model: undefined,
    isIdle: mock(() => true),
    signal: undefined,
    abort: mock(() => undefined),
    hasPendingMessages: mock(() => false),
    shutdown: mock(() => undefined),
    getContextUsage: mock(() => undefined),
    compact: mock(() => undefined),
    getSystemPrompt: mock(() => ""),
    waitForIdle,
    newSession: mock(async () => ({ cancelled: false })),
    fork: mock(async () => ({ cancelled: false })),
    navigateTree: mock(async () => ({ cancelled: false })),
    switchSession: mock(async () => ({ cancelled: false })),
    reload: mock(async () => undefined),
  };

  return { ctx, ui, waitForIdle };
}

function createUi(): ExtensionUIContext & {
  notify: ReturnType<typeof mock>;
  setEditorText: ReturnType<typeof mock>;
} {
  return {
    select: mock(async () => undefined),
    confirm: mock(async () => false),
    input: mock(async () => undefined),
    notify: mock(() => undefined),
    onTerminalInput: mock(() => () => undefined),
    setStatus: mock(() => undefined),
    setWorkingMessage: mock(() => undefined),
    setWorkingVisible: mock(() => undefined),
    setWorkingIndicator: mock(() => undefined),
    setHiddenThinkingLabel: mock(() => undefined),
    setWidget: mock(() => undefined),
    setFooter: mock(() => undefined),
    setHeader: mock(() => undefined),
    setTitle: mock(() => undefined),
    custom: mock(async () => undefined as never),
    pasteToEditor: mock(() => undefined),
    setEditorText: mock(() => undefined),
    getEditorText: mock(() => ""),
    editor: mock(async () => undefined),
    addAutocompleteProvider: mock(() => undefined),
    setEditorComponent: mock(() => undefined),
    getEditorComponent: mock(() => undefined),
    theme: {
      fg: (_name: string, text: string) => text,
      bold: (text: string) => text,
      italic: (text: string) => text,
      strikethrough: (text: string) => text,
    } as never,
    getAllThemes: mock(() => []),
    getTheme: mock(() => undefined),
    setTheme: mock(() => ({ success: false, error: "not available" })),
    getToolsExpanded: mock(() => false),
    setToolsExpanded: mock(() => undefined),
  };
}

function messageEntry(message: UserMessage | AssistantMessage): SessionEntry {
  return {
    type: "message",
    id: "entry-id",
    parentId: null,
    timestamp: new Date(0).toISOString(),
    message,
  };
}

function userMessage(text: string): UserMessage {
  return {
    role: "user",
    content: text,
    timestamp: 0,
  };
}

function assistantMessage(text: string, stopReason: StopReason = "stop"): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "anthropic-messages",
    provider: "test-provider",
    model: "test-model",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    timestamp: 0,
  };
}
