import {
  createAgentSession,
  createExtensionRuntime,
  type ExtensionContext,
  ModelRuntime,
  type ResourceLoader,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { buildAuditorPrompt } from "./prompts";
import type { GoalAuditorRunInput, GoalAuditorRunResult } from "./types";

export function parseAuditorDecision(output: string): { approved: boolean; disapproved: boolean } {
  const approved = /<approved\s*\/>/.test(output);
  const disapproved = /<disapproved\s*\/>/.test(output);
  return { approved: approved && !disapproved, disapproved };
}

export async function runGoalCompletionAuditor(
  ctx: ExtensionContext,
  input: GoalAuditorRunInput,
): Promise<GoalAuditorRunResult> {
  const outputParts: string[] = [];
  try {
    const modelRuntime = await createAuditorModelRuntime(ctx);
    const { session } = await createAgentSession({
      cwd: ctx.cwd,
      model: ctx.model,
      modelRuntime,
      resourceLoader: makeAuditorResourceLoader(),
      sessionManager: SessionManager.inMemory(ctx.cwd),
      settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
    });

    const unsubscribe = session.subscribe((event) => {
      if (event.type !== "message_end") return;
      const message = event.message;
      if (message.role !== "assistant") return;
      for (const part of message.content ?? []) {
        if (part.type === "text" && typeof part.text === "string") outputParts.push(part.text);
      }
    });

    try {
      if (input.signal?.aborted) return { approved: false, disapproved: true, output: "", error: "Auditor aborted." };
      await session.prompt(buildAuditorPrompt(input));
    } finally {
      unsubscribe();
    }

    const output = outputParts.join("\n\n").trim();
    const decision = parseAuditorDecision(output);
    return { ...decision, output };
  } catch (error) {
    return {
      approved: false,
      disapproved: true,
      output: outputParts.join("\n\n").trim(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function createAuditorModelRuntime(ctx: ExtensionContext): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create();
  const model = ctx.model;
  if (!model) return runtime;

  const providerConfig = ctx.modelRegistry.getRegisteredProviderConfig(model.provider);
  if (providerConfig) runtime.registerProvider(model.provider, providerConfig);

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (auth.ok && auth.apiKey) await runtime.setRuntimeApiKey(model.provider, auth.apiKey);

  return runtime;
}

function makeAuditorResourceLoader(): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () =>
      [
        "You are a completion auditor running in an isolated Pi agent session.",
        "Inspect the repository and decide whether the claimed autonomous goal completion is genuinely satisfied.",
        "Do not mutate files or run destructive commands. Never approve unless the actual user objective is complete.",
      ].join("\n"),
    getAppendSystemPrompt: () => [],
    extendResources: () => undefined,
    reload: async () => undefined,
  };
}
