import {
  type Api,
  type AssistantMessage,
  type Context,
  createAssistantMessageEventStream,
  type Model,
  type SimpleStreamOptions,
  type ToolCall,
  type Usage,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createCodexCompactionRuntime, registerCodexCompactionExtension } from "./lib/register";

export const CODEX_COMPACTION_LIFECYCLE_TEST_PROVIDER = "openai-codex";
export const CODEX_COMPACTION_LIFECYCLE_TEST_MODEL = "gpt-5.6-sol";
export const CODEX_COMPACTION_LIFECYCLE_TEST_API_KEY_ENV = "CODEX_COMPACTION_LIFECYCLE_E2E_API_KEY";
export const CODEX_COMPACTION_LIFECYCLE_TEST_USAGE_ENV = "CODEX_COMPACTION_LIFECYCLE_E2E_USAGE";
export const CODEX_COMPACTION_LIFECYCLE_FINAL_TEXT = "continued automatically after compaction";
export const CODEX_COMPACTION_LIFECYCLE_TEST_SCENARIO_ENV = "CODEX_COMPACTION_LIFECYCLE_E2E_SCENARIO";

const api = "openai-codex-responses";
const zeroUsage: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
export default function (pi: ExtensionAPI) {
  let sentToolCalls = 0;
  const scenario = process.env[CODEX_COMPACTION_LIFECYCLE_TEST_SCENARIO_ENV];
  const toolTurns = scenario === "post-compaction-small-tail" ? 2 : 1;
  const configuredTokens = Number(process.env[CODEX_COMPACTION_LIFECYCLE_TEST_USAGE_ENV] ?? 246_000);
  const thresholdUsage: Usage = {
    ...zeroUsage,
    input: configuredTokens,
    totalTokens: configuredTokens,
  };

  registerCodexCompactionExtension(pi, {
    // Exercise the production eligibility guard; only the paid compaction boundary is replaced.
    ...createCodexCompactionRuntime(),
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
      if (sentToolCalls < toolTurns) {
        sentToolCalls += 1;
        const largePrefix = scenario === "post-compaction-small-tail" && sentToolCalls === 1;
        const failingTool = scenario === "small-history" || sentToolCalls === 2;
        return streamToolCall(model, options, thresholdUsage, sentToolCalls, largePrefix, failingTool);
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

function streamToolCall(
  model: Model<Api>,
  options: SimpleStreamOptions | undefined,
  usage: Usage,
  turn: number,
  largePrefix: boolean,
  failingTool: boolean,
) {
  const toolCall: ToolCall = failingTool
    ? { type: "toolCall" as const, id: `failing-probe-${turn}`, name: "bash", arguments: { command: "exit 2" } }
    : { type: "toolCall" as const, id: `read-probe-${turn}`, name: "read", arguments: { path: "probe.txt" } };
  // More than the default 20k retained tokens makes the first split-turn compaction real.
  // Once the user prefix is compacted, this retained assistant is the earliest cut point;
  // the second short tool turn has no older projected messages that can be discarded.
  const prefix = largePrefix ? "Literal retained evidence. ".repeat(4000) : "";
  const content: AssistantMessage["content"] = prefix ? [{ type: "text", text: prefix }, toolCall] : [toolCall];
  const toolIndex = prefix ? 1 : 0;
  const message = assistantMessage(model, content, "toolUse", usage);
  const stream = createAssistantMessageEventStream();

  queueMicrotask(async () => {
    await options?.onPayload?.({ model: model.id, input: [], stream: true }, model);
    await options?.onResponse?.({ status: 200, headers: {} }, model);

    const partial = {
      ...message,
      content: [...content.slice(0, toolIndex), { ...toolCall, arguments: {} }],
      stopReason: "pending" as const,
    };
    stream.push({ type: "start", partial: { ...message, content: [], stopReason: "pending" } });
    if (prefix) {
      stream.push({ type: "text_start", contentIndex: 0, partial });
      stream.push({ type: "text_delta", contentIndex: 0, delta: prefix, partial });
      stream.push({ type: "text_end", contentIndex: 0, content: prefix, partial });
    }
    stream.push({ type: "toolcall_start", contentIndex: toolIndex, partial });
    stream.push({
      type: "toolcall_delta",
      contentIndex: toolIndex,
      delta: JSON.stringify(toolCall.arguments),
      partial,
    });
    stream.push({ type: "toolcall_end", contentIndex: toolIndex, toolCall, partial: message });
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
