import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readStatuslineConfig } from "./config";
import { formatStatusline, type StatuslineStyle } from "./format";
import { createStatuslineRuntime } from "./runtime";
import { createYahooStockQuoteProvider } from "./stock";
import type { CommandRunner, StatuslineRuntime } from "./types";

const STATUS_KEY = "thierry-statusline";

export type RegisterStatuslineOptions = {
  refreshMs: number;
};

export function registerStatuslineExtension(pi: ExtensionAPI): void {
  const config = readStatuslineConfig();
  const runtime = createStatuslineRuntime(createPiCommandRunner(pi), createYahooStockQuoteProvider(config.stock));
  registerStatusline(pi, runtime, { refreshMs: config.refreshMs });
}

export function registerStatusline(
  pi: ExtensionAPI,
  runtime: StatuslineRuntime,
  options: RegisterStatuslineOptions,
): void {
  let timer: ReturnType<typeof setInterval> | undefined;
  let currentContext: ExtensionContext | undefined;
  let refreshInFlight = false;
  let refreshAgain = false;

  async function refresh(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) return;

    currentContext = ctx;
    if (refreshInFlight) {
      refreshAgain = true;
      return;
    }

    refreshInFlight = true;
    try {
      do {
        refreshAgain = false;
        const snapshot = await runtime.loadStatus(ctx.cwd, ctx.signal);
        const text = formatStatusline(snapshot, createThemeStyle(ctx));
        ctx.ui.setStatus(STATUS_KEY, text);
      } while (refreshAgain);
    } finally {
      refreshInFlight = false;
    }
  }

  function startTimer(ctx: ExtensionContext): void {
    if (!ctx.hasUI || timer) return;

    timer = setInterval(() => {
      if (currentContext) void refresh(currentContext);
    }, options.refreshMs);
    timer.unref?.();
  }

  function stopTimer(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = undefined;
  }

  pi.on("session_start", async (_event, ctx) => {
    startTimer(ctx);
    await refresh(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    await refresh(ctx);
  });

  pi.on("session_shutdown", async () => {
    stopTimer();
  });
}

function createThemeStyle(ctx: ExtensionContext): StatuslineStyle {
  return {
    pullRequest: (text) => ctx.ui.theme.fg("accent", text),
    added: (text) => ctx.ui.theme.fg("success", text),
    removed: (text) => ctx.ui.theme.fg("error", text),
    changed: (text) => ctx.ui.theme.fg("warning", text),
    untracked: (text) => ctx.ui.theme.fg("muted", text),
    binary: (text) => ctx.ui.theme.fg("dim", text),
    stock: (text) => ctx.ui.theme.fg("warning", text),
    separator: (text) => ctx.ui.theme.fg("dim", text),
  };
}

function createPiCommandRunner(pi: ExtensionAPI): CommandRunner {
  return {
    async run(command, args, options) {
      const result = await pi.exec(command, args, {
        cwd: options.cwd,
        signal: options.signal,
        timeout: options.timeoutMs,
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code,
        killed: result.killed,
      };
    },
  };
}
