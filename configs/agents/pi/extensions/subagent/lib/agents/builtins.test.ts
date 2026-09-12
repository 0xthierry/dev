import { expect, test } from "bun:test";
import { BUILTIN_AGENTS } from "./builtins";

test("defaults both built-in agents to high effort without pinning a model", () => {
  // Arrange
  const agents = BUILTIN_AGENTS;

  // Act
  const defaults = agents.map(({ name, execution }) => ({ name, execution }));

  // Assert
  expect(defaults).toEqual([
    { name: "scout", execution: { effort: "high" } },
    { name: "worker", execution: { effort: "high" } },
  ]);
});
