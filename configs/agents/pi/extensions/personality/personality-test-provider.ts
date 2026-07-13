import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  type Model,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const PERSONALITY_TEST_PROVIDERS = ["openai", "openai-codex"] as const;
export const PERSONALITY_TEST_MODEL = "personality-e2e-model";
export const PERSONALITY_TEST_API_KEY_ENV = "PERSONALITY_E2E_API_KEY";

const api = "personality-e2e-api";
const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const model = {
  id: PERSONALITY_TEST_MODEL,
  name: "Personality E2E Model",
  reasoning: false,
  input: ["text"] as ("text" | "image")[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 1_024,
};

export default function (pi: ExtensionAPI) {
  for (const provider of PERSONALITY_TEST_PROVIDERS) {
    pi.registerProvider(provider, {
      name: `Personality E2E ${provider}`,
      baseUrl: "http://localhost:0",
      apiKey: `$${PERSONALITY_TEST_API_KEY_ENV}`,
      api,
      streamSimple,
      models: [model],
    });
  }
}

function streamSimple(model: Model<Api>, context: Context) {
  const stream = createAssistantMessageEventStream();

  queueMicrotask(() => {
    const text = context.systemPrompt ?? "";
    const message = buildAssistantMessage(model, text);

    stream.push({ type: "start", partial: { ...message, content: [] } });
    stream.push({
      type: "text_start",
      contentIndex: 0,
      partial: { ...message, content: [{ type: "text", text: "" }] },
    });
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: text,
      partial: { ...message, content: [{ type: "text", text }] },
    });
    stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
  });

  return stream;
}

function buildAssistantMessage(model: Model<Api>, text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason: "stop",
    timestamp: Date.now(),
  };
}
