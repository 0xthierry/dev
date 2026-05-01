import { describe, expect, test } from "bun:test";
import { createFakePi } from "./fake-pi";

type FakeTool = (
  toolCallId: string,
  params: unknown,
  signal: AbortSignal | undefined,
  onUpdate: unknown,
  ctx: unknown,
) => Promise<unknown>;

describe("createFakePi", () => {
  test("records registered commands", () => {
    // Arrange
    const fakePi = createFakePi();
    const pi = fakePi.pi as unknown as {
      registerCommand: (name: string, command: { description: string; handler: () => unknown }) => void;
    };

    // Act
    pi.registerCommand("demo", {
      description: "Demo command",
      handler: () => "ok",
    });

    // Assert
    expect(fakePi.commands.get("demo")?.description).toBe("Demo command");
  });

  test("runs registered tools with a fake context", async () => {
    // Arrange
    const fakePi = createFakePi({ cwd: "/tmp/project" });
    const pi = fakePi.pi as unknown as {
      registerTool: (tool: { name: string; description: string; execute: FakeTool }) => void;
    };
    pi.registerTool({
      name: "demo_tool",
      description: "Demo tool",
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        const typedParams = params as { value: string };
        const typedCtx = ctx as { cwd: string };
        return { content: [{ type: "text", text: `${typedCtx.cwd}:${typedParams.value}` }] };
      },
    });

    // Act
    const result = await fakePi.runTool("demo_tool", { value: "ok" });

    // Assert
    expect(result).toEqual({ content: [{ type: "text", text: "/tmp/project:ok" }] });
  });

  test("emits handlers in registration order", async () => {
    // Arrange
    const fakePi = createFakePi();
    const pi = fakePi.pi as unknown as { on: (eventName: string, handler: () => unknown) => void };
    const calls: string[] = [];
    pi.on("tool_call", () => {
      calls.push("first");
      return { first: true };
    });
    pi.on("tool_call", () => {
      calls.push("second");
      return { second: true };
    });

    // Act
    const results = await fakePi.emit("tool_call", { toolName: "bash", input: {} });

    // Assert
    expect(calls).toEqual(["first", "second"]);
    expect(results).toEqual([{ first: true }, { second: true }]);
  });
});
