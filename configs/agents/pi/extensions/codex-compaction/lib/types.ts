import type { Api, Model, ProviderHeaders, Usage } from "@earendil-works/pi-ai";

export const CODEX_COMPACTION_DETAILS_VERSION_V1 = 1;
export const CODEX_COMPACTION_DETAILS_VERSION = 2;
export const CODEX_COMPACTION_SENTINEL_PREFIX = "pi-codex-compaction";
export const CODEX_COMPACTION_CUSTOM_INVALIDATION = "codex-compaction-invalidated";
export const SEAM_STRIKE_THRESHOLD = 2;
export const SUMMARY_SEARCH_WINDOW = 16;
export const RECOVERY_PROMPT_MARGIN_TOKENS = 4096;
export const CODEX_OPAQUE_SUMMARY_PLACEHOLDER =
  "[Opaque Codex compaction artifact — replaced only on compatible Codex provider requests.]";

export type JsonObject = Record<string, unknown>;

export type CodexCompactionItem = {
  type: "compaction";
  encrypted_content: string;
  id?: string;
};

type BindingTarget = {
  provider: string;
  api: string;
  modelId: string;
  endpoint: string;
};

// Absence of scope preserves the persisted direct v2 format.
export type DirectCodexBinding = BindingTarget & { scope?: never; accountHash: string };
export type ProxyCodexBinding = BindingTarget & { scope: "proxy"; proxyKeyHash: string };
export type CodexBinding = DirectCodexBinding | ProxyCodexBinding;

// A proxy credential identifies the local proxy boundary, never an upstream account.
export type CodexIdentity =
  | { kind: "direct"; apiKey: string; headers?: ProviderHeaders; accountId: string; binding: DirectCodexBinding }
  | { kind: "proxy"; apiKey: string; headers?: ProviderHeaders; binding: ProxyCodexBinding };

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

export type CodexModel = Model<Api> &
  ({ api: "openai-codex-responses" } | { provider: "cliproxyapi"; api: "openai-responses" });

export type CompactionAuth = {
  apiKey?: string;
  headers?: ProviderHeaders;
  env?: Record<string, string>;
};

export type CodexRequestOptions = {
  model: CodexModel;
  identity: CodexIdentity;
  systemPrompt: string;
  input: JsonObject[];
  tools?: JsonObject[];
  signal?: AbortSignal;
  thinkingLevel: string;
  sessionId?: string;
};

export type CodexCompactionRetryClass = "transport" | "stream" | "terminal";

export type CodexRemoteCompactionResult =
  | {
      ok: true;
      item: CodexCompactionItem;
      responseId?: string;
      usage?: Usage;
    }
  | {
      ok: false;
      reason: string;
      retryClass: CodexCompactionRetryClass;
      retryAfterMs?: number;
      status?: number;
      aborted?: boolean;
      responseId?: string;
      usage?: Usage;
      requestAttempts?: number;
      streamAttempts?: number;
      exhausted?: boolean;
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
