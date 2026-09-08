import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { createAutoAcceptBrowserUseApprovalHandler, createBrowserUseApprovalHandler } from "./approval";
import { BROWSER_USE_COMMAND_COMPLETIONS, BROWSER_USE_COMMAND_USAGE, parseBrowserUseCommand } from "./command";
import {
  BROWSER_USE_PARAMETERS,
  BROWSER_USE_PROMPT_GUIDELINES,
  BROWSER_USE_PROMPT_SNIPPET,
  BROWSER_USE_STATUS_COMMAND,
  BROWSER_USE_TOOL_NAME,
} from "./definitions";
import { formatBrowserUseContent } from "./output";
import { type BrowserUsePaths, type BrowserUsePathsResult, resolveBrowserUsePaths } from "./paths";
import { type BrowserUseRuntime, createBrowserUseRuntime } from "./runtime";
import { browserUseToolDescription, parseBrowserUseCode, summarizeBrowserUseCode } from "./tool";

export type BrowserUseHost = {
  resolvePaths(): BrowserUsePathsResult;
  createRuntime(paths: BrowserUsePaths): BrowserUseRuntime;
  skillRoot(): string;
};

export function createBrowserUseHost(): BrowserUseHost {
  return {
    resolvePaths: () => resolveBrowserUsePaths(),
    createRuntime: (paths) => createBrowserUseRuntime(paths),
    skillRoot: () => join(dirname(fileURLToPath(import.meta.url)), "../skills/control-browser"),
  };
}

const registeredApis = new WeakSet<ExtensionAPI>();

export function registerBrowserUseExtension(pi: ExtensionAPI, host: BrowserUseHost = createBrowserUseHost()): void {
  const paths = host.resolvePaths();
  let runtime: BrowserUseRuntime | undefined;
  let enabled = false;
  let acceptPermissions = false;

  if (registeredApis.has(pi)) return;
  registeredApis.add(pi);

  pi.registerCommand(BROWSER_USE_STATUS_COMMAND, {
    // No arguments: status is read-only file discovery, not a live connection probe.
    description: "Show Browser Use runtime file availability",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      ctx.ui.notify(JSON.stringify({ enabled, acceptPermissions, ...paths }, null, 2), paths.available ? "info" : "warning");
    },
  });

  pi.registerCommand("browser-use", {
    description: "Enable, disable, or check Browser Use for this session (default: off)",
    getArgumentCompletions: (prefix) =>
      BROWSER_USE_COMMAND_COMPLETIONS.filter((value) => value.startsWith(prefix)).map((value) => ({
        value,
        label: value,
      })),
    handler: async (args, ctx) => {
      const command = parseBrowserUseCommand(args);
      if (command.mode === "invalid") {
        if (ctx.hasUI) ctx.ui.notify(BROWSER_USE_COMMAND_USAGE, "warning");
        return;
      }
      if (command.mode === "on") {
        if (!paths.available) {
          if (ctx.hasUI) ctx.ui.notify(paths.reason, "warning");
          return;
        }
        enabled = true;
        acceptPermissions = command.acceptPermissions;
      } else if (command.mode === "off") {
        enabled = false;
        acceptPermissions = false;
        const previous = runtime;
        runtime = undefined;
        await previous?.close();
      }
      if (ctx.hasUI) {
        const extra =
          command.mode === "off"
            ? " JavaScript bindings cleared; the tool remains available."
            : command.mode === "on" && acceptPermissions
              ? " All browser permission prompts are auto-accepted for this session."
              : "";
        ctx.ui.notify(`Browser Use is ${enabled ? "on" : "off"}.${extra}`, "info");
      }
    },
  });

  if (!paths.available) return;

  pi.on("resources_discover", async () => ({ skillPaths: [host.skillRoot()] }));

  pi.registerTool({
    name: BROWSER_USE_TOOL_NAME,
    label: "Browser Use",
    description: browserUseToolDescription(paths.browserClient),
    promptSnippet: BROWSER_USE_PROMPT_SNIPPET,
    promptGuidelines: BROWSER_USE_PROMPT_GUIDELINES,
    parameters: BROWSER_USE_PARAMETERS,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!enabled) throw new Error("Browser Use is disabled. Ask the user to enable it with /browser-use on.");
      runtime ??= host.createRuntime(paths);
      const active = runtime;
      const approve = acceptPermissions
        ? createAutoAcceptBrowserUseApprovalHandler()
        : createBrowserUseApprovalHandler(async (message, approvalSignal) => {
            if (!ctx.hasUI) return undefined;
            return ctx.ui.confirm("Browser permission", message, { signal: approvalSignal });
          });
      const result = await active.execute(parseBrowserUseCode(params), signal, approve);
      return {
        content: formatBrowserUseContent(result.content),
        details: { isError: result.isError },
      };
    },
    renderCall(args, theme) {
      const firstLine = summarizeBrowserUseCode(args);
      const label = theme.fg("toolTitle", theme.bold(BROWSER_USE_TOOL_NAME));
      return new Text(firstLine ? `${label} ${theme.fg("dim", firstLine)}` : label, 0, 0);
    },
  });

  // Pi ignores an isError field returned by execute. Its tool_result hook can mark
  // failure without throwing away screenshots emitted before a JavaScript error.
  pi.on("tool_result", (event) => {
    if (event.toolName !== BROWSER_USE_TOOL_NAME) return;
    if (
      event.details &&
      typeof event.details === "object" &&
      "isError" in event.details &&
      event.details.isError === true
    ) {
      return { isError: true };
    }
  });

  pi.on("session_start", () => {
    pi.setActiveTools([...new Set([...pi.getActiveTools(), BROWSER_USE_TOOL_NAME])]);
  });
  pi.on("agent_settled", () => runtime?.endTurn());
  pi.on("session_shutdown", async () => {
    enabled = false;
    acceptPermissions = false;
    const previous = runtime;
    runtime = undefined;
    await previous?.close();
  });
}
