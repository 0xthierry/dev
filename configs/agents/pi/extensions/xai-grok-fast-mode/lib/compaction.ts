import { isDirectXaiGrokModel, type ProviderModel } from "./model";

export const XAI_GROK_AUTO_COMPACTION_THRESHOLD_RATIO = 0.85;

export function xaiGrokCompactionThreshold(model: ProviderModel | undefined): number | undefined {
  if (!isDirectXaiGrokModel(model)) return undefined;

  const contextWindow = model.contextWindow;
  if (contextWindow == null || !Number.isFinite(contextWindow) || contextWindow <= 0) return undefined;

  return Math.floor(contextWindow * XAI_GROK_AUTO_COMPACTION_THRESHOLD_RATIO);
}

export function shouldCompactXaiGrok(model: ProviderModel | undefined, currentTokens: number | undefined): boolean {
  const threshold = xaiGrokCompactionThreshold(model);
  return threshold != null && currentTokens != null && Number.isFinite(currentTokens) && currentTokens >= threshold;
}
