import { createHash } from "node:crypto";
import { extractChatGptAccountId, resolveCompactionUrl } from "./model";
import type { CodexBinding, CodexIdentity, CodexModel, CompactionAuth } from "./types";

export function hashAccountId(accountId: string): string {
  return createHash("sha256").update(accountId).digest("hex").slice(0, 16);
}

export function resolveCodexIdentity(model: CodexModel, auth: CompactionAuth): CodexIdentity | undefined {
  if (!auth.apiKey) return undefined;
  const target = {
    provider: model.provider,
    api: model.api,
    modelId: model.id,
    endpoint: resolveCompactionUrl(model),
  };
  if (model.api === "openai-responses") {
    return {
      kind: "proxy",
      apiKey: auth.apiKey,
      headers: auth.headers,
      binding: {
        ...target,
        scope: "proxy",
        proxyKeyHash: createHash("sha256").update(auth.apiKey).digest("hex"),
      },
    };
  }
  const accountId = extractChatGptAccountId(auth.apiKey);
  if (!accountId) return undefined;
  return {
    kind: "direct",
    apiKey: auth.apiKey,
    headers: auth.headers,
    accountId,
    binding: { ...target, accountHash: hashAccountId(accountId) },
  };
}

export function bindingsEqual(left: CodexBinding, right: CodexBinding | undefined): boolean {
  if (!right) return false;
  const identityMatches =
    left.scope === "proxy"
      ? right.scope === "proxy" && left.proxyKeyHash === right.proxyKeyHash
      : right.scope !== "proxy" && left.accountHash === right.accountHash;
  return (
    identityMatches &&
    left.provider === right.provider &&
    left.api === right.api &&
    left.modelId === right.modelId &&
    left.endpoint === right.endpoint
  );
}
