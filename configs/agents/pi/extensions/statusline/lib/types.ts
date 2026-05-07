export type CommandResult = {
  stdout: string;
  stderr: string;
  code: number;
  killed?: boolean;
};

export type CommandRunOptions = {
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export type CommandRunner = {
  run(command: string, args: string[], options: CommandRunOptions): Promise<CommandResult>;
};

export type PullRequestStatus = {
  number: number;
  source: "gh" | "branch";
  url?: string;
};

export type GitChangeSummary = {
  added: number;
  removed: number;
  changedFiles: number;
  untrackedFiles: number;
  binaryFiles: number;
};

export type GitStatusSnapshot = {
  branch: string | null;
  pullRequest: PullRequestStatus | null;
  changes: GitChangeSummary;
};

export type StockQuote = {
  symbol: string;
  label: string;
  price: number;
  currency?: string;
};

export type StatuslineSnapshot = {
  git: GitStatusSnapshot | null;
  stock: StockQuote | null;
};

export type StockQuoteProvider = {
  getQuote(signal?: AbortSignal): Promise<StockQuote | null>;
};

export type StatuslineRuntime = {
  loadStatus(cwd: string, signal?: AbortSignal): Promise<StatuslineSnapshot>;
};
