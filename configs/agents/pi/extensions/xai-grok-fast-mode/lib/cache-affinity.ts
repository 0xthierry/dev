import { isDirectXaiGrokModel, type ProviderModel } from "./model";

export const XAI_GROK_CONVERSATION_HEADER = "x-grok-conv-id";

type ProviderHeaders = Record<string, string | null>;

export function applyXaiGrokCacheAffinity(
  headers: ProviderHeaders,
  model: ProviderModel | undefined,
  sessionId: string | undefined,
): boolean {
  if (!isDirectXaiGrokModel(model) || !sessionId) return false;

  headers[XAI_GROK_CONVERSATION_HEADER] = sessionId;
  return true;
}
