import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DirectBrokerResult } from "./direct-broker";
import { executeDirectTool } from "./direct-service";

const roots: string[] = [];

afterEach(async () => {
  mock.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function brokerResult(text = "ok", isError = false): DirectBrokerResult {
  return {
    content: [{ type: "text", text }],
    isError,
    brokerVersion: "test-app-server",
    clientBuild: "test-client",
    elicitationRequests: 0,
    modelTurnsStarted: 0,
    ephemeralThread: true,
    brokerCleanupVerified: true,
  };
}

describe("executeDirectTool", () => {
  test("passes official arguments and elicitation capability through unchanged", async () => {
    // Arrange
    const root = await mkdtemp(path.join(os.tmpdir(), "direct-service-passthrough."));
    roots.push(root);
    const onElicitation = mock(async () => ({ action: "accept" as const, content: { choice: "allow" } }));
    const callTool = mock(async () => brokerResult());
    const input = {
      method: "press_key" as const,
      arguments: { app: "/Applications/Alternate App.app", key: "CMD+A", futureOption: true },
    };

    // Act
    const response = await executeDirectTool(input, {
      stateRoot: root,
      callTool,
      onElicitation,
      supportsOpenAiFormElicitation: true,
    });

    // Assert
    expect(response.isError).toBe(false);
    expect(callTool).toHaveBeenCalledWith(input.method, input.arguments, {
      signal: undefined,
      timeoutMs: 120_000,
      onElicitation,
      supportsOpenAiFormElicitation: true,
    });
  });

  test("dispatches mutating methods without wrapper prompts and redacts contentful audit data", async () => {
    // Arrange
    const root = await mkdtemp(path.join(os.tmpdir(), "direct-service-privacy."));
    roots.push(root);
    const callTool = mock(async () => brokerResult("typed"));

    // Act
    const response = await executeDirectTool(
      { method: "type_text", arguments: { app: "TextEdit", text: "arbitrary direct action" } },
      { stateRoot: root, callTool },
    );
    const auditText = await readFile(path.join(root, "audit", "direct-computer-use.jsonl"), "utf8");
    const audit = JSON.parse(auditText) as Record<string, unknown>;

    // Assert
    expect(response.isError).toBe(false);
    expect(callTool).toHaveBeenCalledTimes(1);
    expect(auditText).not.toContain("arbitrary direct action");
    expect(auditText).not.toContain("TextEdit");
    expect(audit.method).toBe("type_text");
    expect(audit.directCalls).toBe(1);
    expect(String(audit.app)).toMatch(/^target-sha256:[a-f0-9]{16}$/);
  });

  test("rejects invalid direct arguments before dispatch and records metadata only", async () => {
    // Arrange
    const root = await mkdtemp(path.join(os.tmpdir(), "direct-service-invalid."));
    roots.push(root);
    const callTool = mock(async () => brokerResult());

    // Act
    const execution = executeDirectTool(
      { method: "press_key", arguments: { app: "TextEdit" } },
      { stateRoot: root, callTool },
    );

    // Assert
    await expect(execution).rejects.toThrow("did not match a tool schema");
    expect(callTool).not.toHaveBeenCalled();
    const audit = JSON.parse(await readFile(path.join(root, "audit", "direct-computer-use.jsonl"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(audit.method).toBe("invalid_request");
    expect(audit.outcome).toBe("input_rejected");
  });
});
