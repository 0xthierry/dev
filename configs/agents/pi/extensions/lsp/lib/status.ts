import { commandExists, commandFromEnv } from "./command";
import type { LspServerAdapter } from "./types";

export function buildStatusMessage(adapters: LspServerAdapter[], cwd: string): string {
  if (adapters.length === 0) return "No LSP servers are configured.";

  return adapters
    .flatMap((adapter) => {
      const command = commandFromEnv(adapter.commandEnvVar, adapter.defaultCommand);
      const routeDescription = describeRoutes(adapter);
      return [
        `${adapter.name} LSP command: ${command.command} ${command.args.join(" ")}`.trim(),
        `${adapter.name} routes: ${routeDescription}`,
        `${adapter.name} status: ${commandExists(command.command, cwd) ? "ready" : "command missing"}`,
      ];
    })
    .join("\n");
}

export function statusLevel(adapters: LspServerAdapter[], cwd: string): "info" | "warning" {
  return adapters.every((adapter) => {
    const command = commandFromEnv(adapter.commandEnvVar, adapter.defaultCommand);
    return commandExists(command.command, cwd);
  })
    ? "info"
    : "warning";
}

function describeRoutes(adapter: LspServerAdapter): string {
  const routes = [...adapter.extensions, ...adapter.fileNames];
  return routes.length ? routes.join(", ") : "none";
}
