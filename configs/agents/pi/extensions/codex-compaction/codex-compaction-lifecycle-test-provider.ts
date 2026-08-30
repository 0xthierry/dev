import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type Usage,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCodexCompactionExtension } from "./lib/register";

export const CODEX_COMPACTION_LIFECYCLE_TEST_PROVIDER = "openai-codex";
export const CODEX_COMPACTION_LIFECYCLE_TEST_MODEL = "gpt-5.6-sol";
export const CODEX_COMPACTION_LIFECYCLE_TEST_API_KEY_ENV = "CODEX_COMPACTION_LIFECYCLE_E2E_API_KEY";
export const CODEX_COMPACTION_LIFECYCLE_FINAL_TEXT = "continued automatically after compaction";

const api = "openai-codex-responses";
const zeroUsage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const thresholdUsage: Usage = {
  ...zeroUsage,
  input: 246_000,
  totalTokens: 246_000,
};

export default function (pi: ExtensionAPI) {
  let sentToolCall = false;

  registerCodexCompactionExtension(pi, {
    remoteCompact: async ({ preparation }) => ({
      summary: "Deterministic Codex compaction lifecycle summary.",
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      details: { readFiles: ["probe.txt"], modifiedFiles: [] },
    }),
    portableCompactOnly: async () => undefined,
  });

  pi.registerProvider(CODEX_COMPACTION_LIFECYCLE_TEST_PROVIDER, {
    name: "Codex Compaction Lifecycle E2E Provider",
    baseUrl: "http://localhost:0",
    apiKey: `$${CODEX_COMPACTION_LIFECYCLE_TEST_API_KEY_ENV}`,
    api,
    streamSimple(model: Model<Api>, _context: Context, options?: SimpleStreamOptions) {
      if (!sentToolCall) {
        sentToolCall = true;
        return streamToolCall(model, options);
      }
      if (options?.signal?.aborted) return streamAborted(model);
      return streamText(model, CODEX_COMPACTION_LIFECYCLE_FINAL_TEXT);
    },
    models: [
      {
        id: CODEX_COMPACTION_LIFECYCLE_TEST_MODEL,
        name: "Codex Compaction Lifecycle E2E Model",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 272_000,
        maxTokens: 32_000,
      },
    ],
  });
}

function streamToolCall(model: Model<Api>, options: SimpleStreamOptions | undefined) {
  const toolCall = { type: "toolCall" as const, id: "read-probe", name: "read", arguments: { path: "probe.txt" } };
  const message = assistantMessage(model, [toolCall], "toolUse", thresholdUsage);
  const stream = createAssistantMessageEventStream();

  queueMicrotask(async () => {
    await options?.onPayload?.({ model: model.id, input: [], stream: true }, model);
    await options?.onResponse?.({ status: 200, headers: {} }, model);

    const partial = { ...message, content: [{ ...toolCall, arguments: {} }], stopReason: "pending" as const };
    stream.push({ type: "start", partial: { ...message, content: [], stopReason: "pending" } });
    stream.push({ type: "toolcall_start", contentIndex: 0, partial });
    stream.push({
      type: "toolcall_delta",
      contentIndex: 0,
      delta: JSON.stringify(toolCall.arguments),
      partial,
    });
    stream.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: message });
    stream.push({ type: "done", reason: "toolUse", message });
    stream.end(message);
  });

  return stream;
}

function streamAborted(model: Model<Api>) {
  const message = {
    ...assistantMessage(model, [], "aborted", zeroUsage),
    errorMessage: "This operation was aborted",
  };
  const stream = createAssistantMessageEventStream();

  queueMicrotask(() => {
    stream.push({ type: "error", reason: "aborted", error: message });
    stream.end(message);
  });

  return stream;
}

function streamText(model: Model<Api>, text: string) {
  const message = assistantMessage(model, [{ type: "text", text }], "stop", zeroUsage);
  const stream = createAssistantMessageEventStream();

  queueMicrotask(() => {
    stream.push({ type: "start", partial: { ...message, content: [], stopReason: "pending" } });
    stream.push({
      type: "text_start",
      contentIndex: 0,
      partial: { ...message, content: [{ type: "text", text: "" }], stopReason: "pending" },
    });
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: text,
      partial: { ...message, content: [{ type: "text", text }], stopReason: "pending" },
    });
    stream.push({ type: "text_end", contentIndex: 0, content: text, partial: message });
    stream.push({ type: "done", reason: "stop", message });
    stream.end(message);
  });

  return stream;
}

function assistantMessage(
  model: Model<Api>,
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"],
  usage: Usage,
): AssistantMessage {
  return {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason,
    timestamp: Date.now(),
  };
}
