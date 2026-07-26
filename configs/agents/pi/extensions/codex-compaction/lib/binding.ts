import { createHash } from "node:crypto";
import { resolveCodexResponsesUrl } from "./model";
import type { CodexBinding, CodexCompactionV2, CodexModel } from "./types";

export function hashAccountId(accountId: string): string {
  return createHash("sha256").update(accountId).digest("hex").slice(0, 16);
}

export function normalizeEndpoint(baseUrl: string | undefined): string {
  return resolveCodexResponsesUrl(baseUrl);
}

export function createBinding(model: CodexModel, accountId: string): CodexBinding {
  return {
    provider: model.provider,
    api: model.api,
    modelId: model.id,
    endpoint: normalizeEndpoint(model.baseUrl),
    accountHash: hashAccountId(accountId),
  };
}

export function bindingsEqual(left: CodexBinding, right: CodexBinding): boolean {
  return (
    left.provider === right.provider &&
    left.api === right.api &&
    left.modelId === right.modelId &&
    left.endpoint === right.endpoint &&
    left.accountHash === right.accountHash
  );
}

export function isCompatibleV2Binding(
  record: CodexCompactionV2,
  model: { provider: string; api: string; id: string; baseUrl?: string },
  accountHash: string | undefined,
): boolean {
  if (accountHash === undefined) return false;

  return bindingsEqual(record.binding, {
    provider: model.provider,
    api: model.api,
    modelId: model.id,
    endpoint: normalizeEndpoint(model.baseUrl),
    accountHash,
  });
}
