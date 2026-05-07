import { describe, expect, mock, test } from "bun:test";
import { createStatuslineRuntime } from "./runtime";
import type { CommandResult, CommandRunner, CommandRunOptions, StockQuoteProvider } from "./types";

describe("createStatuslineRuntime", () => {
  test("combines git status and stock quote snapshots", async () => {
    // Arrange
    const runner: CommandRunner = {
      run: mock(async (_command: string, args: string[], _options: CommandRunOptions): Promise<CommandResult> => {
        const key = args.join(" ");
        if (key === "rev-parse --show-toplevel") return ok("/repo\n");
        if (key === "branch --show-current") return ok("main\n");
        if (key === "status --porcelain=v1 --untracked-files=normal") return ok(" M README.md\n");
        if (key === "diff --numstat HEAD --") return ok("1\t0\tREADME.md\n");
        return { stdout: "", stderr: "", code: 1 };
      }),
    };
    const stockProvider: StockQuoteProvider = {
      getQuote: mock(async () => ({ symbol: "NET", label: "NET", price: 80, currency: "USD" })),
    };
    const runtime = createStatuslineRuntime(runner, stockProvider);

    // Act
    const result = await runtime.loadStatus("/repo");

    // Assert
    expect(result).toEqual({
      git: {
        branch: "main",
        pullRequest: null,
        changes: { added: 1, removed: 0, changedFiles: 1, untrackedFiles: 0, binaryFiles: 0 },
      },
      stock: { symbol: "NET", label: "NET", price: 80, currency: "USD" },
    });
    expect(stockProvider.getQuote).toHaveBeenCalledTimes(1);
  });
});

function ok(stdout: string): CommandResult {
  return { stdout, stderr: "", code: 0 };
}
