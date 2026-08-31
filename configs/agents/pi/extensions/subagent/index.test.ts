import { expect, test } from "bun:test";
import { createFakePi } from "../_shared/testing/fake-pi";
import registerExtension from "./index";

test("entrypoint registers the persistent subagent boundary", () => {
  // Arrange
  const fakePi = createFakePi();

  // Act
  registerExtension(fakePi.pi);

  // Assert
  expect([...fakePi.tools.keys()]).toEqual([
    "agent_spawn",
    "agent_send",
    "agent_followup",
    "agent_wait",
    "agent_interrupt",
    "agent_list",
    "agent_close",
  ]);
});
