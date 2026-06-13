import type { Api, Model } from "@earendil-works/pi-ai";

export const CODEX_COMPACTION_DETAILS_VERSION = 1;
export const CODEX_COMPACTION_CUSTOM_INVALIDATION = "codex-compaction-invalidated";
export const CODEX_COMPACTION_SENTINEL_PREFIX = "pi-codex-compaction";

export type JsonObject = Record<string, unknown>;

export type CodexCompactionItem = {
  type: "compaction";
  encrypted_content: string;
  id?: string;
};

export type CodexCompactionDetails = {
  codexCompaction: {
    version: typeof CODEX_COMPACTION_DETAILS_VERSION;
    sentinel: string;
    provider: string;
    api: string;
    modelId: string;
    item: CodexCompactionItem;
  };
};

export type CodexCompactionInvalidation = {
  compactionEntryId?: string;
  sentinel: string;
  status: number;
};

export type CodexModel = Model<Api> & {
  api: "openai-codex-responses";
};

export type CodexRequestOptions = {
  model: CodexModel;
  apiKey: string;
  headers?: Record<string, string>;
  accountId: string;
  systemPrompt: string;
  input: JsonObject[];
  tools?: JsonObject[];
  signal?: AbortSignal;
  thinkingLevel: string;
};

export type CodexCompactionFetchResult = { ok: true; item: CodexCompactionItem } | { ok: false; reason: string };

export type InjectionResult =
  | { injected: true; sentinel: string }
  | { injected: false; reason: "not-codex-payload" | "no-active-compaction" | "invalidated" | "summary-not-found" };
