import type { Api, Model, Provider } from "@earendil-works/pi-ai";
import type { ProviderConfig } from "@earendil-works/pi-coding-agent";

export const OPENAI_CODEX_PROVIDER_ID = "openai-codex";

type OpenAICodexProviderModule = {
  openaiCodexProvider(): Provider;
};

export async function createCodexMultiAuthProviderConfig(options: {
  bridgeBaseUrl: string;
  bridgeClientApiKey: string;
}): Promise<ProviderConfig> {
  const provider = await loadOpenAICodexProvider();
  const models = provider.getModels().map(toBridgeModel);

  return {
    name: "OpenAI Codex (multi-account)",
    baseUrl: options.bridgeBaseUrl,
    apiKey: options.bridgeClientApiKey,
    api: "openai-responses",
    models,
  };
}

async function loadOpenAICodexProvider(): Promise<Provider> {
  const moduleUrl = import.meta.resolve("@earendil-works/pi-ai/providers/openai-codex");
  const module = (await import(moduleUrl)) as OpenAICodexProviderModule;
  return module.openaiCodexProvider();
}

function toBridgeModel({ api: _api, baseUrl: _baseUrl, provider: _provider, ...model }: Model<Api>) {
  return {
    ...model,
    name: `${model.name} (multi-account)`,
  };
}
