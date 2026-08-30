import { isDirectXaiGrokModel, type ProviderModel } from "./model";

const PRIORITY_SERVICE_TIER = "priority";

type JsonObject = Record<string, unknown>;

export function applyXaiGrokFastMode(payload: unknown, model: ProviderModel | undefined): JsonObject | undefined {
  if (!isDirectXaiGrokModel(model) || !isJsonObject(payload)) return undefined;
  if (payload.service_tier === PRIORITY_SERVICE_TIER) return undefined;

  return {
    ...payload,
    service_tier: PRIORITY_SERVICE_TIER,
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
