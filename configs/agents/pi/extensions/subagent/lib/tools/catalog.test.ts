import { expect, test } from "bun:test";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import { AGENT_TOOL_NAMES, registerAgentTools } from "./catalog";
import { createFakeToolsRuntime } from "./test-support";

test("registers exactly the stable seven-tool catalog in order", () => {
  // Arrange
  const fakePi = createFakePi();

  // Act
  registerAgentTools(fakePi.pi, createFakeToolsRuntime());

  // Assert
  expect([...fakePi.tools.keys()]).toEqual([...AGENT_TOOL_NAMES]);
  expect(fakePi.tools.has("agent")).toBe(false);
});

test("keeps every flattened guideline attributable and prompts stable", () => {
  // Arrange
  const fakePi = createFakePi();
  registerAgentTools(fakePi.pi, createFakeToolsRuntime());

  // Act
  const definitions = [...fakePi.tools.values()];

  // Assert
  for (const definition of definitions) {
    const guidelines = definition.promptGuidelines as string[];
    expect(guidelines.length).toBeGreaterThan(0);
    for (const guideline of guidelines) expect(guideline).toContain(`${definition.name}:`);
    expect(definition.promptSnippet).toBeString();
    expect(definition.promptSnippet).not.toMatch(/\b(?:pid|token|timestamp|running|queued)[:=]\S/i);
  }
});

test("documents the critical lifecycle semantics in the stable catalog", () => {
  // Arrange
  const fakePi = createFakePi();
  registerAgentTools(fakePi.pi, createFakeToolsRuntime());
  const text = (name: string) => {
    const tool = fakePi.tools.get(name);
    return [tool?.description, tool?.promptSnippet, ...((tool?.promptGuidelines as string[]) ?? [])].join(" ");
  };

  // Act
  const catalog = Object.fromEntries(AGENT_TOOL_NAMES.map((name) => [name, text(name)]));

  // Assert
  expect(catalog.agent_spawn).toMatch(/persistent child.*running.*prompt.*queued.*startup.*neither.*completion/i);
  expect(catalog.agent_spawn).not.toMatch(/running or queued.*prompt (?:was )?accepted/i);
  expect(catalog.agent_spawn).toMatch(/artifact-backed completion.*direct parent/i);
  expect(catalog.agent_send).toMatch(/16 KiB.*never starts an assignment/i);
  expect(catalog.agent_followup).toMatch(/idle.*starts.*active.*queues.*unloaded.*reloads/i);
  expect(catalog.agent_wait).toMatch(/level-triggered.*30 seconds.*one hour/i);
  expect(catalog.agent_interrupt).toMatch(/resumable|preserving.*session/i);
  expect(catalog.agent_list).toMatch(/snapshot.*provenance/i);
  expect(catalog.agent_close).toMatch(/permanent.*cannot be resumed/i);
  expect(catalog.agent_close).not.toMatch(/descendant/i);
});
