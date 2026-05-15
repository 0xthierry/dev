import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readTokenSpeedConfig } from "./config";
import { TOKEN_SPEED_STATUS_KEY } from "./constants";
import { TokenSpeedEngine } from "./engine";
import { getAssistantDeltaTokenCount, isAssistantMessage } from "./events";
import { formatTokenSpeedStatus, IDLE_TOKEN_SPEED_MEASUREMENT } from "./status";
import type { TokenSpeedConfigResult, TokenSpeedMeasurement } from "./types";

export type TokenSpeedRuntime = {
  engine: TokenSpeedEngine;
  loadConfig(): TokenSpeedConfigResult;
};

export function createTokenSpeedRuntime(): TokenSpeedRuntime {
  return {
    engine: new TokenSpeedEngine(),
    loadConfig: readTokenSpeedConfig,
  };
}

export function registerTokenSpeedExtension(pi: ExtensionAPI): void {
  registerTokenSpeed(pi, createTokenSpeedRuntime());
}

export function registerTokenSpeed(pi: ExtensionAPI, runtime: TokenSpeedRuntime): void {
  let configResult: TokenSpeedConfigResult | undefined;

  const getConfigResult = () => {
    configResult ??= runtime.loadConfig();
    return configResult;
  };

  const publishStatus = (ctx: ExtensionContext, measurement: TokenSpeedMeasurement = IDLE_TOKEN_SPEED_MEASUREMENT) => {
    if (!ctx.hasUI) return;

    const { config } = getConfigResult();
    const text = formatTokenSpeedStatus(config, measurement, {
      dim: (value) => ctx.ui.theme.fg("dim", value),
    });
    ctx.ui.setStatus(TOKEN_SPEED_STATUS_KEY, text);
  };

  pi.on("session_start", async (_event, ctx) => {
    if (!ctx.hasUI) return;

    const { warnings } = getConfigResult();
    for (const warning of warnings) ctx.ui.notify(warning, "warning");
    publishStatus(ctx);
  });

  pi.on("message_start", async (event, ctx) => {
    if (!isAssistantMessage(event.message)) return;

    runtime.engine.start();
    publishStatus(ctx, runtime.engine.snapshot());
  });

  pi.on("message_update", async (event, ctx) => {
    const tokenCount = getAssistantDeltaTokenCount(event.assistantMessageEvent);
    if (tokenCount === 0) return;

    runtime.engine.recordTokens(tokenCount);
    publishStatus(ctx, runtime.engine.snapshot());
  });

  pi.on("message_end", async (event, ctx) => {
    if (!isAssistantMessage(event.message) || !runtime.engine.isStreaming) return;

    publishStatus(ctx, runtime.engine.stop());
  });

  pi.on("turn_end", async (_event, ctx) => {
    if (!runtime.engine.isStreaming) return;

    publishStatus(ctx, runtime.engine.stop());
  });

  pi.on("session_shutdown", async () => {
    runtime.engine.reset();
  });
}
