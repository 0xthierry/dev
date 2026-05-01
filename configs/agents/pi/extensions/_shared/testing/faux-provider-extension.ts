import { fauxAssistantMessage, registerFauxProvider } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export const FAUX_PROVIDER_NAME = "pi-extension-e2e-faux";
export const FAUX_MODEL_ID = "pi-extension-e2e-faux-model";
export const FAUX_API_KEY_ENV = "PI_EXTENSION_E2E_FAUX_API_KEY";
export const FAUX_RESPONSE_TEXT_ENV = "PI_EXTENSION_E2E_FAUX_RESPONSE_TEXT";
export const DEFAULT_FAUX_RESPONSE_TEXT = "Pi extension E2E faux response.";

const model = {
  id: FAUX_MODEL_ID,
  name: "Pi Extension E2E Faux Model",
  reasoning: false,
  input: ["text"] as ("text" | "image")[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 1_024,
};

export default function (pi: ExtensionAPI) {
  const faux = registerFauxProvider({
    provider: FAUX_PROVIDER_NAME,
    models: [model],
    tokensPerSecond: 0,
  });

  faux.setResponses([fauxAssistantMessage(getFauxResponseText())]);

  pi.registerProvider(FAUX_PROVIDER_NAME, {
    name: "Pi Extension E2E Faux Provider",
    baseUrl: "http://localhost:0",
    apiKey: FAUX_API_KEY_ENV,
    api: faux.api,
    models: [model],
  });
}

function getFauxResponseText(): string {
  return process.env[FAUX_RESPONSE_TEXT_ENV] || DEFAULT_FAUX_RESPONSE_TEXT;
}
