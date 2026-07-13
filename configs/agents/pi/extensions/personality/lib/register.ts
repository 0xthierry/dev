import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const OPENAI_PROVIDERS = new Set(["openai", "openai-codex"]);

const PERSONALITY = `You are a pragmatic, effective software engineer.
You take engineering quality seriously and use a direct, factual and
brief communication style with the user without unnecessary detail.`;

export function registerPersonalityExtension(pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event, ctx) => {
    if (!ctx.model || !OPENAI_PROVIDERS.has(ctx.model.provider)) return undefined;

    return {
      systemPrompt: `${event.systemPrompt}\n\n${PERSONALITY}`,
    };
  });
}
