import { expect, test } from "bun:test";
import { SupervisorError } from "../supervisor/supervisor";
import { successResult, toolBoundary } from "./shared";

test("formats typed supervisor errors at the tool boundary", async () => {
  // Arrange
  const operation = "agent_send";

  // Act
  const result = await toolBoundary(operation, async () => {
    throw new SupervisorError("invalid_message", "message is invalid");
  });

  // Assert
  expect(result).toMatchObject({
    details: { ok: false, operation, error: { kind: "invalid_message", message: "message is invalid" } },
  });
});

test("returns typed details and model-visible JSON", () => {
  // Arrange
  const value = { status: "running" };

  // Act
  const result = successResult("agent_spawn", value);

  // Assert
  expect(result).toMatchObject({ details: { ok: true, result: value } });
  expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("running") });
});
