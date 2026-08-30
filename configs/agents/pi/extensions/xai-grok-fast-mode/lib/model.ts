const XAI_PROVIDER = "xai";
const GROK_MODEL_PREFIX = "grok-";

export type ProviderModel = {
  provider: string;
  id: string;
  contextWindow?: number;
};

export function isDirectXaiGrokModel(model: ProviderModel | undefined): model is ProviderModel {
  return model?.provider === XAI_PROVIDER && model.id.startsWith(GROK_MODEL_PREFIX);
}
