import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const CODEX_FAST_MODE_TEST_PROVIDER = "cliproxyapi";
export const CODEX_FAST_MODE_TEST_API_KEY_ENV = "CODEX_FAST_MODE_E2E_API_KEY";
export const CODEX_FAST_MODE_TEST_MODELS = [
  "gpt-5.6",
  "gpt-6-luna",
  "gpt-5.6-sol",
  "gpt-6-astra",
  "gpt-6-sol",
] as const;

const api = "codex-fast-mode-e2e-api";
const usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export default function (pi: ExtensionAPI) {
  pi.registerProvider(CODEX_FAST_MODE_TEST_PROVIDER, {
    name: "Codex Fast Mode E2E Provider",
    baseUrl: "http://localhost:0",
    apiKey: CODEX_FAST_MODE_TEST_API_KEY_ENV,
    api,
    streamSimple,
    models: CODEX_FAST_MODE_TEST_MODELS.map((id) => ({
      id,
      name: `Codex Fast Mode E2E ${id}`,
      reasoning: false,
      input: ["text"] as const,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 1_024,
    })),
  });
}

function streamSimple(model: Model<Api>, _context: Context, options?: SimpleStreamOptions) {
  const stream = createAssistantMessageEventStream();

  queueMicrotask(async () => {
    const originalPayload = buildCodexPayload(model.id, options?.sessionId);
    const payload = (await options?.onPayload?.(originalPayload, model)) ?? originalPayload;
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

function buildCodexPayload(model: string, sessionId: string | undefined): Record<string, unknown> {
  return {
    model,
    store: false,
    stream: true,
    instructions: "You are a helpful assistant.",
    input: [],
    text: { verbosity: "low" },
    include: ["reasoning.encrypted_content"],
    prompt_cache_key: sessionId,
    tool_choice: "auto",
    parallel_tool_calls: true,
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
