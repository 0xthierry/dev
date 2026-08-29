import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const XAI_GROK_FAST_MODE_TEST_PROVIDER = "xai";
export const XAI_GROK_FAST_MODE_TEST_MODEL = "grok-4.6";
export const XAI_GROK_FAST_MODE_TEST_API_KEY_ENV = "XAI_GROK_FAST_MODE_E2E_API_KEY";

const api = "xai-grok-fast-mode-e2e-api";
const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export default function (pi: ExtensionAPI) {
  pi.registerProvider(XAI_GROK_FAST_MODE_TEST_PROVIDER, {
    name: "xAI Grok Fast Mode E2E Provider",
    baseUrl: "http://localhost:0",
    apiKey: `$${XAI_GROK_FAST_MODE_TEST_API_KEY_ENV}`,
    api,
    streamSimple,
    models: [
      {
        id: XAI_GROK_FAST_MODE_TEST_MODEL,
        name: "xAI Grok Fast Mode E2E Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 1_024,
      },
    ],
  });
}

function streamSimple(model: Model<Api>, _context: Context, options?: SimpleStreamOptions) {
  const stream = createAssistantMessageEventStream();

  queueMicrotask(async () => {
    const payload = await options?.onPayload?.(buildXaiPayload(), model);
    const text = `service_tier=${readServiceTier(payload)}`;
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

function buildXaiPayload(): Record<string, unknown> {
  return {
    model: XAI_GROK_FAST_MODE_TEST_MODEL,
    input: [],
    stream: true,
  };
}

function readServiceTier(payload: unknown): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "missing";
  const serviceTier = (payload as Record<string, unknown>).service_tier;
  return typeof serviceTier === "string" ? serviceTier : "missing";
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
