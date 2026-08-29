const XAI_PROVIDER = "xai";
const GROK_MODEL_PREFIX = "grok-";
const PRIORITY_SERVICE_TIER = "priority";

type ProviderModel = {
  provider: string;
  id: string;
};

type JsonObject = Record<string, unknown>;

export function applyXaiGrokFastMode(payload: unknown, model: ProviderModel | undefined): JsonObject | undefined {
  if (!isDirectXaiGrokModel(model) || !isJsonObject(payload)) return undefined;
  if (payload.service_tier === PRIORITY_SERVICE_TIER) return undefined;

  return {
    ...payload,
    service_tier: PRIORITY_SERVICE_TIER,
  };
}

function isDirectXaiGrokModel(model: ProviderModel | undefined): boolean {
  return model?.provider === XAI_PROVIDER && model.id.startsWith(GROK_MODEL_PREFIX);
}

function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
