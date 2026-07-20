import { describe, expect, test } from "bun:test";
import { createFakePi } from "../../_shared/testing/fake-pi";
import { registerCodexDetailedReasoningExtension } from "./register";

describe("registerCodexDetailedReasoningExtension", () => {
  test("registers a before_provider_request payload rewriter", async () => {
    // Arrange
    const fakePi = createFakePi();
    const payload = {
      model: "gpt-5.6-sol",
      store: false,
      stream: true,
      instructions: "You are a helpful assistant.",
      input: [],
      text: { verbosity: "low" },
      include: ["reasoning.encrypted_content"],
      prompt_cache_key: "session-id",
      tool_choice: "auto",
      parallel_tool_calls: true,
      reasoning: { effort: "high", summary: "auto" },
    };

    // Act
    registerCodexDetailedReasoningExtension(fakePi.pi);
    const results = await fakePi.emit("before_provider_request", { payload });

    // Assert
    expect(fakePi.handlers.get("before_provider_request")?.length).toBe(1);
    expect(results).toEqual([{ ...payload, reasoning: { effort: "high", summary: "detailed" } }]);
  });
});
