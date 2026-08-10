import type { Api, Model, ProviderHeaders, Usage } from "@earendil-works/pi-ai";

export const CODEX_COMPACTION_DETAILS_VERSION_V1 = 1;
export const CODEX_COMPACTION_DETAILS_VERSION = 2;
export const CODEX_COMPACTION_SENTINEL_PREFIX = "pi-codex-compaction";
export const CODEX_COMPACTION_CUSTOM_INVALIDATION = "codex-compaction-invalidated";
export const SEAM_STRIKE_THRESHOLD = 2;
export const SUMMARY_SEARCH_WINDOW = 16;
export const RECOVERY_PROMPT_MARGIN_TOKENS = 4096;

export type JsonObject = Record<string, unknown>;

export type CodexCompactionItem = {
  type: "compaction";
  encrypted_content: string;
  id?: string;
};

export type CodexBinding = {
  provider: string;
  api: string;
  modelId: string;
  endpoint: string;
  accountHash: string;
};

export type CodexRecoveryInfo = {
  attempted: boolean;
  truncated: boolean;
  recoveredMessages: number;
};

export type CodexCompactionV1 = {
  version: typeof CODEX_COMPACTION_DETAILS_VERSION_V1;
  sentinel: string;
  provider: string;
  api: string;
  modelId: string;
  item: CodexCompactionItem;
};

export type CodexCompactionV2 = {
  version: typeof CODEX_COMPACTION_DETAILS_VERSION;
  binding: CodexBinding;
  userPrefix: JsonObject[];
  artifact: CodexCompactionItem[];
  firstKeptEntryId: string;
  tokensBefore: number;
  responseId?: string;
  remoteUsage?: Usage;
  recovery?: CodexRecoveryInfo;
};

export type CodexCompactionRecord = CodexCompactionV1 | CodexCompactionV2;

export type CompactionFileDetails = {
  readFiles?: string[];
  modifiedFiles?: string[];
};

export type CompactionEntryDetails = CompactionFileDetails & {
  codexCompaction?: CodexCompactionRecord;
  recovery?: CodexRecoveryInfo;
};

export type CodexModel = Model<Api> & {
  api: "openai-codex-responses";
};

export type CodexRequestOptions = {
  model: CodexModel;
  apiKey: string;
  headers?: ProviderHeaders;
  accountId: string;
  systemPrompt: string;
  input: JsonObject[];
  tools?: JsonObject[];
  signal?: AbortSignal;
  thinkingLevel: string;
  sessionId?: string;
};

export type CodexCompactionFetchResult =
  | {
      ok: true;
      item: CodexCompactionItem;
      responseId?: string;
      usage?: Usage;
    }
  | {
      ok: false;
      reason: string;
      aborted?: boolean;
      responseId?: string;
      usage?: Usage;
    };

export type InjectionMode =
  | { kind: "artifact"; userPrefix: JsonObject[]; artifact: CodexCompactionItem[] }
  | { kind: "prefix-only"; userPrefix: JsonObject[] }
  | { kind: "none"; reason: string };

export type CodexCompactionInvalidation = {
  compactionEntryId?: string;
  sentinel?: string;
  status?: number;
};
