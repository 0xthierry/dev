import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const FAUX_PROVIDER_NAME = "pi-extension-e2e-faux";
export const FAUX_MODEL_ID = "pi-extension-e2e-faux-model";
export const FAUX_API_KEY_ENV = "PI_EXTENSION_E2E_FAUX_API_KEY";
export const FAUX_RESPONSE_TEXT_ENV = "PI_EXTENSION_E2E_FAUX_RESPONSE_TEXT";
export const FAUX_TOOL_CALLS_ENV = "PI_EXTENSION_E2E_FAUX_TOOL_CALLS";
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

  faux.setResponses(getFauxResponses());

  pi.registerProvider(FAUX_PROVIDER_NAME, {
    name: "Pi Extension E2E Faux Provider",
    baseUrl: "http://localhost:0",
    apiKey: FAUX_API_KEY_ENV,
    api: faux.api,
    models: [model],
  });
}

function getFauxResponses() {
  const toolCalls = getFauxToolCalls();
  const finalMessage = fauxAssistantMessage(getFauxResponseText());
  if (toolCalls.length === 0) return [finalMessage];
  return [fauxAssistantMessage(toolCalls, { stopReason: "toolUse" }), finalMessage];
}

function getFauxToolCalls() {
  const raw = process.env[FAUX_TOOL_CALLS_ENV];
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${FAUX_TOOL_CALLS_ENV} must be a JSON array`);
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`${FAUX_TOOL_CALLS_ENV}[${index}] must be an object`);
    const value = item as Record<string, unknown>;
    if (typeof value.name !== "string" || !value.name) {
      throw new Error(`${FAUX_TOOL_CALLS_ENV}[${index}].name must be a non-empty string`);
    }
    const args = value.arguments ?? {};
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw new Error(`${FAUX_TOOL_CALLS_ENV}[${index}].arguments must be an object when provided`);
    }
    const id = typeof value.id === "string" && value.id ? value.id : undefined;
    return fauxToolCall(value.name, args as Record<string, unknown>, id ? { id } : undefined);
  });
}

function getFauxResponseText(): string {
  return process.env[FAUX_RESPONSE_TEXT_ENV] || DEFAULT_FAUX_RESPONSE_TEXT;
}
