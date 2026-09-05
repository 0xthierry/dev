import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createCodexMultiAuthBackend } from "./backend";
import { createCodexMultiAuthProviderConfig, OPENAI_CODEX_PROVIDER_ID } from "./provider";
import { type CodexMultiAuthRuntime, createCodexMultiAuthRuntime } from "./runtime";

export async function createRuntime(): Promise<CodexMultiAuthRuntime> {
  return createCodexMultiAuthRuntime(await createCodexMultiAuthBackend());
}

export async function registerCodexMultiAuthExtension(
  pi: ExtensionAPI,
  runtime?: CodexMultiAuthRuntime,
): Promise<void> {
  const activeRuntime = runtime ?? (await createRuntime());
  const activation = await activeRuntime.prepare();
  let startupError: string | undefined;
  let started = false;

  pi.registerCommand("codex-multi-auth-status", {
    description: "Show Pi's Codex multi-account routing status",
    handler: async (_args, ctx) => {
      if (activation.state === "inactive") {
        ctx.ui.notify("Codex multi-account routing is inactive — run `codex-multi-auth login --device-auth`.", "info");
        return;
      }
      if (startupError) {
        ctx.ui.notify(`Codex multi-account routing failed: ${startupError}`, "error");
        return;
      }

      const accountLabel = `${activation.accountCount} account${activation.accountCount === 1 ? "" : "s"}`;
      ctx.ui.notify(`Codex multi-account routing is ${started ? "active" : "ready"} · ${accountLabel}`, "info");
    },
  });

  if (activation.state === "inactive") return;

  pi.registerProvider(
    OPENAI_CODEX_PROVIDER_ID,
    await createCodexMultiAuthProviderConfig({
      bridgeBaseUrl: activation.bridgeBaseUrl,
      bridgeClientApiKey: activation.bridgeClientApiKey,
    }),
  );

  pi.on("session_start", async (_event, ctx) => {
    try {
      await activation.start();
      started = true;
    } catch (error) {
      startupError = error instanceof Error ? error.message : String(error);
      if (ctx.hasUI) {
        ctx.ui.notify(`Codex multi-account routing failed to start: ${startupError}`, "error");
      }
      throw error;
    }
  });

  pi.on("session_shutdown", () => activation.close());
}
