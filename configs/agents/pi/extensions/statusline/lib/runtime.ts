import { loadGitStatus } from "./git";
import type { CommandRunner, StatuslineRuntime, StatuslineSnapshot, StockQuoteProvider } from "./types";

export function createStatuslineRuntime(runner: CommandRunner, stockProvider: StockQuoteProvider): StatuslineRuntime {
  return {
    async loadStatus(cwd: string, signal?: AbortSignal): Promise<StatuslineSnapshot> {
      const [git, stock] = await Promise.all([loadGitStatus(runner, cwd, signal), stockProvider.getQuote(signal)]);
      return { git, stock };
    },
  };
}
