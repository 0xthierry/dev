import { expect, test } from "bun:test";
import { discoverAgents } from "./discovery";

test("discovers only the worker fallback when no file-backed agents are installed", async () => {
  // Arrange
  const options = { projectTrusted: false };

  // Act
  const result = await discoverAgents(options);

  // Assert
  expect(result.agents.map(({ name, source, execution }) => ({ name, source, execution }))).toEqual([
    { name: "worker", source: "builtin", execution: { effort: "high" } },
  ]);
});
