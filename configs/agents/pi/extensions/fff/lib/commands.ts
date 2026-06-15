import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { FffRuntime, HealthCheck, NoticeLevel, ScanProgress } from "./types";

const MESSAGE_TYPE = "fff";

type CwdProvider = () => string;

export function registerFffCommands(pi: ExtensionAPI, runtime: FffRuntime, getActiveCwd: CwdProvider): void {
  pi.registerCommand("fff-health", {
    description: "Show FFF file finder health and status.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const finder = runtime.getFinder() ?? (await runtime.ensureFinder(ctx.cwd || getActiveCwd()));
      const health = finder.healthCheck();
      if (!health.ok) {
        sendNotice(pi, ctx, `FFF health check failed: ${health.error}`, "error");
        return;
      }

      const progress = finder.getScanProgress();
      sendNotice(pi, ctx, formatHealthMessage(health.value, progress.ok ? progress.value : undefined), "info");
    },
  });

  pi.registerCommand("fff-rescan", {
    description: "Trigger FFF to rescan files.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const finder = runtime.getFinder() ?? (await runtime.ensureFinder(ctx.cwd || getActiveCwd()));
      const result = finder.scanFiles();
      if (!result.ok) {
        sendNotice(pi, ctx, `FFF rescan failed: ${result.error}`, "error");
        return;
      }

      sendNotice(pi, ctx, "FFF rescan triggered", "info");
    },
  });
}

export function formatHealthMessage(health: HealthCheck, progress?: ScanProgress): string {
  const lines = [
    `FFF v${health.version}`,
    `Tools: overriding grep, find, and multi_grep`,
    `Git: ${health.git.repositoryFound ? `yes (${health.git.workdir ?? "unknown"})` : "no"}`,
    `Picker: ${health.filePicker.initialized ? `${health.filePicker.indexedFiles ?? 0} files` : "not initialized"}`,
    `Frecency: ${health.frecency.initialized ? "active" : "disabled"}`,
    `Query tracker: ${health.queryTracker.initialized ? "active" : "disabled"}`,
  ];

  if (progress) {
    lines.push(
      `Scanning: ${progress.isScanning ? "yes" : "no"} (${progress.scannedFilesCount} files)`,
      `Index ready: ${progress.isWarmupComplete ? "yes" : "warming"}`,
    );
  }

  return lines.join("\n");
}

export function sendNotice(
  pi: ExtensionAPI,
  ctx: { hasUI?: boolean; ui?: { notify?: (message: string, type?: NoticeLevel) => void } },
  content: string,
  level: NoticeLevel,
): void {
  if (ctx.hasUI && ctx.ui?.notify) {
    ctx.ui.notify(content, level);
    return;
  }

  pi.sendMessage({
    customType: MESSAGE_TYPE,
    content,
    display: true,
    details: { level },
  });
}
