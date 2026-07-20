const CODEX_DETAILED_REASONING_SUMMARY = "detailed";
const CODEX_DETAILED_REASONING_MODELS = new Set([
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
]);

type JsonObject = Record<string, unknown>;

/**
 * Pi hardcodes `reasoning.summary: "auto"` for ChatGPT-backed Codex requests
 * and exposes no setting for it. The backend's summarizer decides the detail
 * level, and under "auto" the GPT-5.6 family often returns headline-only
 * summaries. Request "detailed" explicitly instead. Keep the payload matcher
 * narrow so OpenAI API-key traffic and models that reject `reasoning.summary`
 * values are left untouched.
 */
export function applyCodexDetailedReasoning(payload: unknown): JsonObject | undefined {
  if (!isCodexReasoningPayload(payload)) return undefined;

  const reasoning = payload.reasoning as JsonObject;
  if (reasoning.summary === CODEX_DETAILED_REASONING_SUMMARY) return undefined;

  return {
    ...payload,
    reasoning: { ...reasoning, summary: CODEX_DETAILED_REASONING_SUMMARY },
  };
}

function isCodexReasoningPayload(payload: unknown): payload is JsonObject {
  if (!isJsonObject(payload)) return false;
  if (typeof payload.model !== "string" || !CODEX_DETAILED_REASONING_MODELS.has(payload.model)) return false;
  if (!isJsonObject(payload.reasoning) || typeof payload.reasoning.summary !== "string") return false;

  return (
    payload.stream === true &&
    payload.store === false &&
    typeof payload.instructions === "string" &&
    Array.isArray(payload.input) &&
    isCodexTextOptions(payload.text) &&
    payload.tool_choice === "auto" &&
    payload.parallel_tool_calls === true
  );
}

function isCodexTextOptions(value: unknown): value is JsonObject {
  return isJsonObject(value) && typeof value.verbosity === "string";
}

function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
