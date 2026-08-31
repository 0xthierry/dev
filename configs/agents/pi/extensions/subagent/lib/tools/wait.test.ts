import { expect, test } from "bun:test";
import { createFakePi } from "../../../_shared/testing/fake-pi";
import { DEFAULT_WAIT_TIMEOUT_MS } from "../supervisor/limits";
import { createFakeToolsRuntime } from "./test-support";
import { registerAgentWaitTool } from "./wait";

test("reads an opaque artifact through the existing tool with bounded pagination", async () => {
  // Arrange
  const fakePi = createFakePi();
  const runtime = createFakeToolsRuntime();
  registerAgentWaitTool(fakePi.pi, runtime);
  const reference = "subagent-artifact:0123456789abcdef0123456789abcdef";

  // Act
  const result = await fakePi.runTool("agent_wait", {
    operation: "read_artifact",
    artifact_ref: reference,
    cursor: 4096,
    page_bytes: 8192,
    page_lines: 80,
  });

  // Assert
  expect(runtime.readArtifactPage).toHaveBeenCalledWith(reference, {
    cursor: 4096,
    maxBytes: 8192,
    maxLines: 80,
  });
  expect(result).toMatchObject({ details: { ok: true, operation: "agent_wait.read_artifact" } });
});

test("returns a prefix-preserving cursor instead of generic tail truncation for escaped pages", async () => {
  // Arrange
  const fakePi = createFakePi();
  const runtime = createFakeToolsRuntime();
  const reference = "subagent-artifact:0123456789abcdef0123456789abcdef";
  const content = "\0".repeat(32 * 1024);
  runtime.readArtifactPage = async () => ({
    ok: true,
    page: { reference, cursor: 0, content, bytes: Buffer.byteLength(content), lines: 1, eof: true },
  });
  registerAgentWaitTool(fakePi.pi, runtime);

  // Act
  const result = (await fakePi.runTool("agent_wait", {
    operation: "read_artifact",
    artifact_ref: reference,
    page_bytes: 32 * 1024,
  })) as { content: Array<{ type: string; text: string }> };
  const visible = JSON.parse(result.content[0]?.type === "text" ? result.content[0].text : "{}") as {
    bytes: number;
    nextCursor: number;
    eof: boolean;
  };

  // Assert
  expect(Buffer.byteLength(result.content[0]?.type === "text" ? result.content[0].text : "")).toBeLessThanOrEqual(
    40 * 1024,
  );
  expect(visible.nextCursor).toBe(visible.bytes);
  expect(visible.nextCursor).toBeLessThan(Buffer.byteLength(content));
  expect(visible.eof).toBe(false);
});

test("uses stable wait defaults and calls the supervisor", async () => {
  // Arrange
  const fakePi = createFakePi();
  const runtime = createFakeToolsRuntime();
  registerAgentWaitTool(fakePi.pi, runtime);

  // Act
  const result = await fakePi.runTool("agent_wait", { targets: ["agent-1"] });

  // Assert
  expect(runtime.supervisor.wait).toHaveBeenCalledWith(
    expect.objectContaining({ targets: ["agent-1"], condition: "all", timeoutMs: DEFAULT_WAIT_TIMEOUT_MS }),
  );
  expect(result).toMatchObject({ details: { ok: true } });
});
