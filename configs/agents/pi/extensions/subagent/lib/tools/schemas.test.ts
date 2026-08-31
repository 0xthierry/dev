import { expect, test } from "bun:test";
import { Value } from "typebox/value";
import { REASONING_EFFORTS } from "../execution/profile";
import { AgentWaitParamsSchema, ExecutionSchema, ListParamsSchema } from "./schemas";

test("accepts effort alone or an atomic provider-model pair", () => {
  // Arrange
  const inputs = [
    {},
    { effort: "high" },
    { provider: "openai", model: "gpt", effort: "medium" },
    { provider: "openai" },
    { model: "gpt" },
  ];

  // Act
  const accepted = inputs.map((input) => Value.Check(ExecutionSchema, input));

  // Assert
  expect(accepted).toEqual([true, true, true, false, false]);
});

test("accepts all seven exact reasoning efforts", () => {
  // Arrange
  const efforts = [...REASONING_EFFORTS, "ultra"];

  // Act
  const accepted = efforts.map((effort) => Value.Check(ExecutionSchema, { effort }));

  // Assert
  expect(accepted).toEqual([true, true, true, true, true, true, true, false]);
});

test("keeps list empty and accepts bounded wait or artifact-read operations", () => {
  // Arrange
  const list = ListParamsSchema as { properties?: Record<string, unknown> };
  const inputs = [
    { targets: ["agent-1"], timeout_seconds: 30 },
    { targets: Array.from({ length: 33 }, (_, index) => `agent-${index}`), timeout_seconds: 30 },
    { targets: ["agent-1"], timeout_seconds: 0.0001 },
    {
      operation: "read_artifact",
      artifact_ref: "subagent-artifact:0123456789abcdef0123456789abcdef",
      cursor: 0,
      page_bytes: 32 * 1024,
      page_lines: 200,
    },
    { operation: "read_artifact", artifact_ref: "opaque", page_bytes: 32 * 1024 + 1 },
    { operation: "read_artifact", artifact_ref: "opaque", page_lines: 201 },
  ];

  // Act
  const accepted = inputs.map((input) => Value.Check(AgentWaitParamsSchema, input));

  // Assert
  expect(list.properties).toEqual({});
  expect(accepted).toEqual([true, true, false, true, false, false]);
});
