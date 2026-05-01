import { describe, expect, mock, test } from "bun:test";
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
      handler: mock(() => "ok"),
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
    const execute = mock(
      async (
        _toolCallId: string,
        params: unknown,
        _signal: AbortSignal | undefined,
        _onUpdate: unknown,
        ctx: unknown,
      ) => {
        const typedParams = params as { value: string };
        const typedCtx = ctx as { cwd: string };
        return { content: [{ type: "text", text: `${typedCtx.cwd}:${typedParams.value}` }] };
      },
    );
    pi.registerTool({
      name: "demo_tool",
      description: "Demo tool",
      execute,
    });

    // Act
    const result = await fakePi.runTool("demo_tool", { value: "ok" });

    // Assert
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[1]).toEqual({ value: "ok" });
    expect(result).toEqual({ content: [{ type: "text", text: "/tmp/project:ok" }] });
  });

  test("emits handlers in registration order", async () => {
    // Arrange
    const fakePi = createFakePi();
    const pi = fakePi.pi as unknown as { on: (eventName: string, handler: () => unknown) => void };
    const calls: string[] = [];
    const first = mock(() => {
      calls.push("first");
      return { first: true };
    });
    const second = mock(() => {
      calls.push("second");
      return { second: true };
    });
    pi.on("tool_call", first);
    pi.on("tool_call", second);

    // Act
    const results = await fakePi.emit("tool_call", { toolName: "bash", input: {} });

    // Assert
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(["first", "second"]);
    expect(results).toEqual([{ first: true }, { second: true }]);
  });
});
