import { expect, test } from "bun:test";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import { AGENT_TOOL_NAMES, registerAgentTools } from "./catalog";
import { SUBAGENT_MODEL_GUIDANCE } from "./model-guidance";
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

test("exposes stable model routing preferences without replacing execution policy", () => {
  // Arrange
  const first = createFakePi();
  const second = createFakePi();

  // Act
  registerAgentTools(first.pi, createFakeToolsRuntime());
  registerAgentTools(second.pi, createFakeToolsRuntime());
  const description = first.tools.get("agent_spawn")?.description ?? "";

  // Assert
  expect(description).toBe(second.tools.get("agent_spawn")?.description ?? "");
  expect(description).toEndWith(SUBAGENT_MODEL_GUIDANCE);
  expect(description).toContain("cliproxyapi/gpt-6-astra is the default for implementation");
  expect(description).toContain("cliproxyapi/gpt-5.6-luna is the default for read-only codebase reconnaissance");
  expect(description).toContain("cliproxyapi/gpt-5.6-sol is an implementation fallback");
  expect(description).toContain("xai/grok-4.6 is the preferred independent-provider reviewer");
  expect(description).toContain("Repository locks still apply");
  expect(description).not.toMatch(/\b(?:xhigh|max|subscription|openai-codex)\b/);
  expect(first.tools.get("agent_followup")?.description).toContain("guidance in agent_spawn");
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
  expect(catalog.agent_spawn).toMatch(/persistent agent.*running.*prompt.*queued.*startup.*neither.*completion/i);
  expect(catalog.agent_spawn).not.toMatch(/running or queued.*prompt (?:was )?accepted/i);
  expect(catalog.agent_spawn).toContain("final result is delivered to you");
  expect(catalog.agent_spawn).toContain("No conversation history is copied by default");
  expect(catalog.agent_spawn).toContain("context.fork_turns all copies the saved parent context");
  expect(catalog.agent_send).toMatch(/steers running work.*saves the message.*does not start a task/i);
  expect(catalog.agent_send).toContain("Use agent_followup for a new task");
  expect(catalog.agent_followup).toMatch(/idle.*starts.*active.*queues.*unloaded.*resumes/i);
  expect(catalog.agent_followup).toContain("Execution changes apply at the next task boundary");
  expect(catalog.agent_wait).toMatch(/current tasks.*all.*every task settles.*any.*one settles/i);
  expect(catalog.agent_wait).toContain("Timeout or caller abort stops only the wait");
  expect(catalog.agent_wait).toContain("no independent work remains");
  expect(catalog.agent_wait).toMatch(/opaque artifact_ref.*nextCursor.*eof.*host path/);
  expect(catalog.agent_interrupt).toMatch(/resumable|preserving.*session/i);
  expect(catalog.agent_list).toMatch(/statuses.*current tasks.*effective provider\/model\/effort/i);
  expect(catalog.agent_list).toContain("do not poll for completion");
  expect(catalog.agent_close).toMatch(/permanent.*cannot be resumed/i);
  expect(catalog.agent_close).not.toMatch(/descendant/i);
});
