import { describe, expect, mock, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { registerCodexFastModeExtension } from "./register";

const payload = {
  model: "gpt-6-luna",
  store: false,
  stream: true,
  instructions: "Test instructions",
  input: [],
  text: { verbosity: "low" },
  tool_choice: "auto",
  parallel_tool_calls: true,
};

function setup() {
  const setStatus = mock();
  const notify = mock();
  const fakePi = createFakePi({
    ctx: {
      hasUI: true,
      model: { provider: "cliproxyapi", id: "gpt-6-luna" },
      ui: { setStatus, notify, theme: { fg: (color: string, text: string) => `${color}:${text}` } },
    },
  });
  registerCodexFastModeExtension(fakePi.pi);
  return { fakePi, setStatus, notify };
}

describe("registerCodexFastModeExtension", () => {
  test("shows a green indicator by default", async () => {
    // Arrange
    const { fakePi, setStatus } = setup();
    // Act
    await fakePi.emit("session_start");
    // Assert
    expect(setStatus).toHaveBeenLastCalledWith("codex-fast-mode", "success:[fast]");
  });

  test("off dims the indicator and stops adding priority; on restores both", async () => {
    // Arrange
    const { fakePi, setStatus } = setup();
    // Act
    await fakePi.runCommand("fast", "off");
    const offResults = await fakePi.emit("before_provider_request", { payload });
    const offStatus = setStatus.mock.calls.at(-1);
    await fakePi.runCommand("fast", "on");
    const onResults = await fakePi.emit("before_provider_request", { payload });
    // Assert
    expect(offStatus).toEqual(["codex-fast-mode", "dim:[fast]"]);
    expect(offResults).toEqual([]);
    expect(onResults).toEqual([{ ...payload, service_tier: "priority" }]);
    expect(setStatus).toHaveBeenLastCalledWith("codex-fast-mode", "success:[fast]");
    expect(fakePi.appendedEntries).toEqual([
      { customType: "codex-fast-mode", data: { enabled: false } },
      { customType: "codex-fast-mode", data: { enabled: true } },
    ]);
    expect(fakePi.sentMessages).toEqual([]);
  });

  test("bare command reports state and invalid arguments do not change it", async () => {
    // Arrange
    const { fakePi, notify } = setup();
    await fakePi.runCommand("fast", "off");
    // Act
    await fakePi.runCommand("fast", "on extra");
    await fakePi.runCommand("fast");
    // Assert
    expect(notify).toHaveBeenCalledWith(
      "Usage: /fast on | /fast off. Use /fast to see the current setting.",
      "warning",
    );
    expect(notify).toHaveBeenLastCalledWith("GPT fast mode off.", "info");
    expect(fakePi.appendedEntries).toEqual([{ customType: "codex-fast-mode", data: { enabled: false } }]);
  });

  for (const event of ["session_start", "session_tree"]) {
    test(`${event} restores branch state and resets when the branch has no setting`, async () => {
      // Arrange
      const { fakePi, setStatus } = setup();
      const sessionManager = {
        getBranch: () => [
          { type: "custom", customType: "codex-fast-mode", data: { enabled: true } },
          { type: "custom", customType: "codex-fast-mode", data: { enabled: false } },
          { type: "custom", customType: "codex-fast-mode", data: { enabled: "on" } },
        ],
      };
      // Act
      await fakePi.emit(event, {}, { sessionManager });
      const restoredStatus = setStatus.mock.calls.at(-1);
      const restoredPayload = await fakePi.emit("before_provider_request", { payload });
      await fakePi.emit(event);
      // Assert
      expect(restoredStatus).toEqual(["codex-fast-mode", "dim:[fast]"]);
      expect(restoredPayload).toEqual([]);
      expect(setStatus).toHaveBeenLastCalledWith("codex-fast-mode", "success:[fast]");
    });
  }

  test("unsupported models clear the indicator without changing the preference", async () => {
    // Arrange
    const { fakePi, setStatus, notify } = setup();
    const unsupported = { model: { provider: "openai", id: "gpt-6-astra" } };
    // Act
    await fakePi.emit("model_select", {}, unsupported);
    const unsupportedStatus = setStatus.mock.calls.at(-1);
    await fakePi.runCommand("fast", "on", unsupported);
    await fakePi.emit("model_select");
    // Assert
    expect(unsupportedStatus).toEqual(["codex-fast-mode", undefined]);
    expect(notify).toHaveBeenLastCalledWith("GPT fast mode on (not applied to the current model/provider).", "info");
    expect(setStatus).toHaveBeenLastCalledWith("codex-fast-mode", "success:[fast]");
  });

  test("offers on/off argument completion", async () => {
    // Arrange
    const { fakePi } = setup();
    const complete = fakePi.commands.get("fast")?.getArgumentCompletions;
    // Act
    const all = await complete?.("");
    const filtered = await complete?.("of");
    const invalid = await complete?.("other");
    // Assert
    expect(all).toEqual([
      { value: "on", label: "on" },
      { value: "off", label: "off" },
    ]);
    expect(filtered).toEqual([{ value: "off", label: "off" }]);
    expect(invalid).toBeNull();
  });

  test("headless commands change payload behavior without UI calls", async () => {
    // Arrange
    const { fakePi, setStatus, notify } = setup();
    // Act
    await fakePi.runCommand("fast", "off", { hasUI: false });
    const off = await fakePi.emit("before_provider_request", { payload });
    await fakePi.runCommand("fast", "on", { hasUI: false });
    const on = await fakePi.emit("before_provider_request", { payload });
    // Assert
    expect(off).toEqual([]);
    expect(on).toEqual([{ ...payload, service_tier: "priority" }]);
    expect(setStatus).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  test("registers a before_provider_request payload rewriter", async () => {
    // Arrange
    const fakePi = createFakePi();
    const payload = {
      model: "gpt-5.6",
      store: false,
      stream: true,
      instructions: "You are a helpful assistant.",
      input: [],
      text: { verbosity: "low" },
      include: ["reasoning.encrypted_content"],
      prompt_cache_key: "session-id",
      tool_choice: "auto",
      parallel_tool_calls: true,
    };

    // Act
    registerCodexFastModeExtension(fakePi.pi);
    const results = await fakePi.emit(
      "before_provider_request",
      { payload },
      { model: { provider: "cliproxyapi", id: "gpt-5.6" } },
    );

    // Assert
    expect(fakePi.handlers.get("before_provider_request")?.length).toBe(1);
    expect(results).toEqual([{ ...payload, service_tier: "priority" }]);
  });
});
