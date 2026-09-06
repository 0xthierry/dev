const CODEX_FAST_MODE_SERVICE_TIER = "priority";
const CODEX_FAST_MODE_MODELS = new Set(["gpt-5.4", "gpt-5.5", "gpt-5.6", "gpt-5.6-terra", "gpt-5.6-luna"]);

type JsonObject = Record<string, unknown>;

/**
 * Codex Fast mode is persisted as "fast" in Codex CLI config, but ChatGPT's
 * Codex responses backend expects the request-time service tier value
 * "priority". Keep this payload rule narrow so OpenAI API-key traffic is not
 * accidentally moved to Priority processing.
 */
export function applyCodexFastMode(payload: unknown): JsonObject | undefined {
  if (!isCodexFastModePayload(payload)) return undefined;
  if (payload.service_tier === CODEX_FAST_MODE_SERVICE_TIER) return undefined;

  return {
    ...payload,
    service_tier: CODEX_FAST_MODE_SERVICE_TIER,
  };
}

function isCodexFastModePayload(payload: unknown): payload is JsonObject {
  if (!isJsonObject(payload)) return false;
  if (typeof payload.model !== "string" || !CODEX_FAST_MODE_MODELS.has(payload.model)) return false;

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
