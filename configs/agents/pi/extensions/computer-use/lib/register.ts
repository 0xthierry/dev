import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { DirectServiceDependencies } from "./broker/direct-service";
import { getDirectStatus } from "./broker/direct-service";
import type { JsonObject } from "./broker/tools";
import type { ComputerUseCodeResult } from "./code/code-executor";
import { ComputerUseCodeExecutor } from "./code/code-executor";
import { toPiContent } from "./pi/content";
import { COMPUTER_USE_CODE_DESCRIPTION, COMPUTER_USE_CODE_PARAMETERS } from "./pi/definitions";
import { handleOfficialElicitation } from "./pi/elicitation";
import { parseComputerUseCode, summarizeComputerUseCode } from "./pi/tool";

interface CodeExecutor {
  execute(code: string, dependencies: DirectServiceDependencies): Promise<ComputerUseCodeResult>;
  close(): Promise<void>;
}

export interface ComputerUseRuntime {
  stateRoot: string;
  codeExecutor: CodeExecutor;
  getStatus(stateRoot: string): JsonObject;
  openUrl(pi: ExtensionAPI, url: string, signal: AbortSignal | undefined): Promise<boolean>;
}

export interface ComputerUseHost {
  platform: NodeJS.Platform;
  createRuntime(): ComputerUseRuntime;
}

export function createComputerUseHost(): ComputerUseHost {
  return {
    platform: process.platform,
    createRuntime: createComputerUseRuntime,
  };
}

export function createComputerUseRuntime(): ComputerUseRuntime {
  return {
    stateRoot: process.env.CODEX_COMPUTER_USE_HOME || path.join(getAgentDir(), "direct-computer-use"),
    codeExecutor: new ComputerUseCodeExecutor(),
    getStatus: getDirectStatus,
    async openUrl(pi, url, signal) {
      return (await pi.exec("/usr/bin/open", ["--", url], { signal, timeout: 15_000 })).code === 0;
    },
  };
}

export function registerComputerUseExtension(pi: ExtensionAPI, host: ComputerUseHost = createComputerUseHost()): void {
  const runtime = host.platform === "darwin" ? host.createRuntime() : undefined;

  pi.registerCommand("computer-use-status", {
    description: "Show Computer Use status",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      if (!runtime) {
        ctx.ui.notify(`Computer Use is unavailable on ${host.platform}; this extension requires macOS.`, "warning");
        return;
      }
      ctx.ui.notify(JSON.stringify(runtime.getStatus(runtime.stateRoot), null, 2), "info");
    },
  });

  if (!runtime) return;

  pi.registerTool({
    name: "computer_use",
    label: "Computer Use",
    description: COMPUTER_USE_CODE_DESCRIPTION,
    promptSnippet: "Run composable JavaScript against OpenAI's official signed macOS Computer Use surface",
    promptGuidelines: [
      "Use computer_use for macOS app UI work, composing known sequential actions in one JavaScript call and emitting only the state needed for the next decision.",
    ],
    parameters: COMPUTER_USE_CODE_PARAMETERS,
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await runtime.codeExecutor.execute(parseComputerUseCode(params), {
        stateRoot: runtime.stateRoot,
        signal,
        supportsOpenAiFormElicitation: true,
        onElicitation: (request) => handleOfficialElicitation(request, ctx, (url) => runtime.openUrl(pi, url, signal)),
      });
      const rendered = await toPiContent(result.content);
      const details: JsonObject = { calls: result.calls };
      if (result.error) details.error = result.error;
      if (rendered.fullOutputPath) details.fullOutputPath = rendered.fullOutputPath;
      return { content: rendered.content, details };
    },
    renderCall(args, theme) {
      const firstLine = summarizeComputerUseCode(args);
      const label = theme.fg("toolTitle", theme.bold("computer_use"));
      return new Text(firstLine ? `${label} ${theme.fg("dim", firstLine)}` : label, 0, 0);
    },
  });

  pi.on("session_start", () => {
    pi.setActiveTools([...new Set([...pi.getActiveTools(), "computer_use"])]);
  });
  pi.on("agent_settled", () => runtime.codeExecutor.close());
  pi.on("session_shutdown", () => runtime.codeExecutor.close());
}
