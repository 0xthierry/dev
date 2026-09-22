const CODEX_FAST_MODE_SERVICE_TIER = "priority";
const CODEX_FAST_MODE_PROVIDERS = new Set(["openai-codex", "cliproxyapi"]);
const CODEX_FAST_MODE_MODELS = new Set([
  "gpt-5.4",
  "gpt-5.5",
  "gpt-5.6",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-6-luna",
]);

type JsonObject = Record<string, unknown>;
export type CodexFastModeModel = { provider: string; id: string };

/**
 * Codex Fast mode is persisted as "fast" in Codex CLI config, but ChatGPT's
 * Codex responses backend expects the request-time service tier value
 * "priority". Keep this payload rule narrow so OpenAI API-key traffic is not
 * accidentally moved to Priority processing.
 */
export function applyCodexFastMode(payload: unknown, model: CodexFastModeModel | undefined): JsonObject | undefined {
  if (!isCodexFastModePayload(payload, model)) return undefined;
  if (payload.service_tier === CODEX_FAST_MODE_SERVICE_TIER) return undefined;

  return {
    ...payload,
    service_tier: CODEX_FAST_MODE_SERVICE_TIER,
  };
}

function isCodexFastModePayload(payload: unknown, model: CodexFastModeModel | undefined): payload is JsonObject {
  if (!model || !CODEX_FAST_MODE_PROVIDERS.has(model.provider) || !CODEX_FAST_MODE_MODELS.has(model.id)) return false;
  if (!isJsonObject(payload) || payload.model !== model.id) return false;

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
