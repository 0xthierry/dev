import { describe, expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import registerExtension from "./index";
import { AGENT_FEEDBACK_TOOL_NAME } from "./lib/tool";

describe("agent-feedback extension entrypoint", () => {
  test("registers the agent_feedback tool", () => {
    // Arrange
    const fakePi = createFakePi();

    // Act
    registerExtension(fakePi.pi);

    // Assert
    expect(fakePi.tools.has(AGENT_FEEDBACK_TOOL_NAME)).toBe(true);
  });
});
