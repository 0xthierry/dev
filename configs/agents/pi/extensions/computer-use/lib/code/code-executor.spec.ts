import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const executorModuleUrl = pathToFileURL(
  resolve("configs/agents/pi/extensions/computer-use/lib/code/code-executor.ts"),
).href;

describe("ComputerUseCodeExecutor Node worker boundary", () => {
  test("keeps forbidden globals and WebAssembly code generation outside the worker sandbox", async () => {
    // Arrange
    const code = `
      let functionEscapeBlocked = false;
      let wasmCompileBlocked = false;
      try { Function("return process")(); } catch { functionEscapeBlocked = true; }
      try { await WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])); }
      catch { wasmCompileBlocked = true; }
      emit({
        processType: typeof process,
        requireType: typeof require,
        functionEscapeBlocked,
        wasmCompileBlocked,
      });
    `;
    const script = `
      import { ComputerUseCodeExecutor } from ${JSON.stringify(executorModuleUrl)};
      const executor = new ComputerUseCodeExecutor({
        execute: async () => ({ isError: false, content: [] }),
        close: async () => undefined,
      });
      const result = await executor.execute(${JSON.stringify(code)}, {});
      process.stdout.write(JSON.stringify(result));
    `;

    // Act
    const process = Bun.spawn(["node", "--no-warnings", "--experimental-transform-types", "--eval", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    const result = JSON.parse(stdout) as { content: Array<{ text?: string }>; error?: string };
    const emitted = JSON.parse(result.content[0]?.text ?? "null") as Record<string, unknown>;

    // Assert
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(result.error).toBeUndefined();
    expect(emitted).toEqual({
      processType: "undefined",
      requireType: "undefined",
      functionEscapeBlocked: true,
      wasmCompileBlocked: true,
    });
  }, 30_000);

  test("terminates model-authored code that exceeds the execution slice", async () => {
    // Arrange
    const script = `
      import { ComputerUseCodeExecutor } from ${JSON.stringify(executorModuleUrl)};
      const executor = new ComputerUseCodeExecutor({
        execute: async () => ({ isError: false, content: [] }),
        close: async () => undefined,
      }, 50);
      const result = await executor.execute("while (true) {}", {});
      process.stdout.write(JSON.stringify(result));
    `;

    // Act
    const process = Bun.spawn(["node", "--no-warnings", "--experimental-transform-types", "--eval", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    const result = JSON.parse(stdout) as { error?: string; calls?: unknown[] };

    // Assert
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(result.error).toContain("execution exceeded 50ms");
    expect(result.calls).toEqual([]);
  }, 30_000);
});
