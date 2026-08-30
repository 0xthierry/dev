import type { Api, Model } from "@earendil-works/pi-ai";
import type { CodexModel } from "./types";

const JWT_CLAIM_PATH = "https://api.openai.com/auth";

export function isCodexResponsesModel(model: Model<Api> | undefined): model is CodexModel {
  return model?.api === "openai-codex-responses";
}

export function codexAutoCompactionThreshold(model: CodexModel): number {
  return Math.floor((model.contextWindow * 9) / 10);
}

export function codexReasoningEffort(model: CodexModel, thinkingLevel: string): string | undefined {
  if (thinkingLevel === "off") return undefined;

  const mapped = model.thinkingLevelMap?.[thinkingLevel as keyof typeof model.thinkingLevelMap];
  if (mapped === null) return undefined;
  if (typeof mapped === "string") return mapped;

  if (thinkingLevel === "minimal") return "low";
  return thinkingLevel;
}

export function resolveCodexResponsesUrl(baseUrl: string | undefined): string {
  const raw = baseUrl && baseUrl.trim().length > 0 ? baseUrl : "https://chatgpt.com/backend-api";
  const normalized = raw.replace(/\/+$/, "");
  if (normalized.endsWith("/codex/responses")) return normalized;
  if (normalized.endsWith("/codex")) return `${normalized}/responses`;
  return `${normalized}/codex/responses`;
}

export function extractChatGptAccountId(token: string): string | undefined {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;

    const payload = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
    const authClaim = payload[JWT_CLAIM_PATH] as Record<string, unknown> | undefined;
    const accountId = authClaim?.chatgpt_account_id;
    return typeof accountId === "string" && accountId.length > 0 ? accountId : undefined;
  } catch {
    return undefined;
  }
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  if (typeof Buffer !== "undefined") {
    return Buffer.from(padded, "base64").toString("utf8");
  }

  return atob(padded);
}
