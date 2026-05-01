import { Impit } from "impit";
import type { CookieMap } from "../gemini/chrome-cookies";
import { getBrowserCookies } from "../gemini/chrome-cookies";
import type { ImageGenerationProvider, ImageGenerationRequest, ImageGenerationResult } from "../types";
import { detectChatGptImageType } from "./agent-browser-protocol";
import {
  buildChatGptCommonHeaders,
  buildChatGptConversationPayload,
  buildChatGptCookieHeader,
  buildChatGptFinalizeBody,
  buildChatGptProofConfig,
  buildChatGptRequirementsToken,
  buildChatGptTargetHeaders,
  CHATGPT_AUTH_SESSION_URL,
  CHATGPT_BASE_URL,
  CHATGPT_CONVERSATION_URL,
  CHATGPT_FINALIZE_URL,
  CHATGPT_PREPARE_URL,
  CHATGPT_USER_AGENT,
  type ChatGptBuildInfo,
  type ChatGptFinalizedRequirements,
  type ChatGptPreparedRequirements,
  type ChatGptSession,
  DEFAULT_CHATGPT_IMAGE_MODEL,
  extractChatGptBuildInfo,
  extractChatGptGeneratedAssets,
  generateChatGptProofToken,
  parseChatGptConversationStream,
} from "./direct-protocol";

const PROVIDER_ID = "chatgpt-web";
const PROVIDER_LABEL = "ChatGPT Web";
const DEFAULT_TIMEOUT_MS = 240_000;
const POLL_INTERVAL_MS = 3_000;
const CHATGPT_COOKIE_HOSTS = ["chatgpt.com", "chat.openai.com", "auth.openai.com", "openai.com"];

type FetchLike = (url: string, init?: RequestInit) => Promise<ChatGptFetchResponse>;

type ChatGptFetchResponse = Response & {
  bytes?: () => Promise<Uint8Array>;
};

export interface ChatGptDirectTransport {
  fetch: FetchLike;
  fetchImage: FetchLike;
  getCookies: (profile?: string) => Promise<{ cookies: CookieMap; browser: string } | null>;
  randomUUID: () => string;
  random: () => number;
  now: () => Date;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  model: string;
  timeoutMs: number;
  pollIntervalMs: number;
}

interface AuthenticatedContext {
  cookieHeader: string;
  accessToken: string;
  build: ChatGptBuildInfo;
  commonHeaders: Record<string, string>;
}

interface FinalizedRequirementsContext {
  token: string;
  proofToken?: string;
}

interface DownloadedChatGptImage {
  bytes: Uint8Array;
  contentType: string | null;
}

export function createChatGptDirectProvider(
  transport: ChatGptDirectTransport = createDefaultChatGptDirectTransport(),
): ImageGenerationProvider {
  return {
    id: PROVIDER_ID,
    aliases: ["chatgpt", "openai-web", "chatgpt-web", "openai"],
    label: PROVIDER_LABEL,
    async generate(request) {
      return generateWithChatGptDirect(request, transport);
    },
  };
}

export function createDefaultChatGptDirectTransport(): ChatGptDirectTransport {
  const impit = new Impit({ browser: "chrome", timeout: DEFAULT_TIMEOUT_MS });
  return {
    fetch: (url, init) => impit.fetch(url, init as never) as unknown as Promise<ChatGptFetchResponse>,
    fetchImage: (url, init) => fetch(url, init) as Promise<ChatGptFetchResponse>,
    getCookies: (profile) => getBrowserCookies({ hosts: CHATGPT_COOKIE_HOSTS, profile }),
    randomUUID: () => crypto.randomUUID(),
    random: () => Math.random(),
    now: () => new Date(),
    sleep: (ms, signal) => sleep(ms, signal),
    model: process.env.PI_CREATE_IMAGE_CHATGPT_MODEL ?? process.env.PI_CHATGPT_WEB_MODEL ?? DEFAULT_CHATGPT_IMAGE_MODEL,
    timeoutMs: readPositiveIntegerEnv("PI_CREATE_IMAGE_CHATGPT_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    pollIntervalMs: readPositiveIntegerEnv("PI_CREATE_IMAGE_CHATGPT_POLL_INTERVAL_MS", POLL_INTERVAL_MS),
  };
}

export async function generateWithChatGptDirect(
  request: ImageGenerationRequest,
  transport: ChatGptDirectTransport,
): Promise<ImageGenerationResult> {
  const cookieResult = await transport.getCookies(request.profile);
  if (!cookieResult) {
    throw new Error("ChatGPT Web cookies were not found. Sign into chatgpt.com in Brave, Chromium, or Chrome.");
  }

  const context = await createAuthenticatedContext(cookieResult.cookies, transport, request.signal);
  const finalizedRequirements = await fetchFinalizedRequirements(context, transport, request.signal);

  const stream = await sendConversationRequest(
    request.prompt,
    context,
    finalizedRequirements,
    transport,
    request.signal,
  );
  if (!stream.conversationId) throw new Error("ChatGPT did not return a conversation id for the image request.");

  const assets = await waitForGeneratedAssets(stream.conversationId, context, transport, request.signal);
  const images = [];
  for (const asset of assets) {
    const downloaded = await downloadGeneratedImage(
      stream.conversationId,
      asset.fileId,
      context,
      transport,
      request.signal,
    );
    const detected = detectChatGptImageType(downloaded.bytes, downloaded.contentType);
    if (!detected) {
      throw new Error(
        `ChatGPT generated image download did not return recognized image bytes. Content-Type: ${
          downloaded.contentType ?? "unknown"
        }, magic: ${Buffer.from(downloaded.bytes.slice(0, 16)).toString("hex")}.`,
      );
    }
    images.push({ ...detected, bytes: downloaded.bytes, providerImageId: asset.fileId });
  }

  return { providerId: PROVIDER_ID, providerLabel: PROVIDER_LABEL, images };
}

async function createAuthenticatedContext(
  cookies: CookieMap,
  transport: ChatGptDirectTransport,
  signal?: AbortSignal,
): Promise<AuthenticatedContext> {
  const cookieHeader = buildChatGptCookieHeader(cookies);
  const home = await fetchText(transport, `${CHATGPT_BASE_URL}/`, {
    headers: { cookie: cookieHeader, "user-agent": CHATGPT_USER_AGENT, referer: `${CHATGPT_BASE_URL}/` },
    signal: timeoutSignal(signal, 60_000),
  });
  const build = extractChatGptBuildInfo(home);
  const session = await fetchJson<ChatGptSession>(transport, CHATGPT_AUTH_SESSION_URL, {
    headers: { cookie: cookieHeader, "user-agent": CHATGPT_USER_AGENT, referer: `${CHATGPT_BASE_URL}/` },
    signal: timeoutSignal(signal, 60_000),
  });
  if (!session.accessToken) throw new Error("ChatGPT auth session did not return an access token.");

  const commonHeaders = buildChatGptCommonHeaders({
    cookieHeader,
    accessToken: session.accessToken,
    clientVersion: build.clientVersion,
    buildNumber: build.buildNumber,
    deviceId: cookies["oai-did"] || transport.randomUUID(),
    sessionId: transport.randomUUID(),
    userAgent: CHATGPT_USER_AGENT,
  });

  return { cookieHeader, accessToken: session.accessToken, build, commonHeaders };
}

async function fetchFinalizedRequirements(
  context: AuthenticatedContext,
  transport: ChatGptDirectTransport,
  signal?: AbortSignal,
): Promise<FinalizedRequirementsContext> {
  const proofOptions = {
    userAgent: CHATGPT_USER_AGENT,
    clientVersion: context.build.clientVersion,
    scriptUrls: context.build.scriptUrls,
    random: transport.random,
    randomUUID: transport.randomUUID,
    now: transport.now,
  };
  const p = buildChatGptRequirementsToken(buildChatGptProofConfig(proofOptions));
  const prepared = await postJson<ChatGptPreparedRequirements>(
    transport,
    CHATGPT_PREPARE_URL,
    {
      ...context.commonHeaders,
      ...buildChatGptTargetHeaders("/backend-api/sentinel/chat-requirements/prepare"),
    },
    { p },
    signal,
  );
  const proofToken = generateChatGptProofToken(prepared.proofofwork, proofOptions);

  const finalized = await postJson<ChatGptFinalizedRequirements>(
    transport,
    CHATGPT_FINALIZE_URL,
    {
      ...context.commonHeaders,
      ...buildChatGptTargetHeaders("/backend-api/sentinel/chat-requirements/finalize"),
    },
    buildChatGptFinalizeBody({ prepareToken: prepared.prepare_token, proofToken }),
    signal,
  );
  if (!finalized.token) throw new Error("ChatGPT Sentinel did not return a chat requirements token.");
  return { token: finalized.token, proofToken };
}

async function sendConversationRequest(
  prompt: string,
  context: AuthenticatedContext,
  requirements: FinalizedRequirementsContext,
  transport: ChatGptDirectTransport,
  signal?: AbortSignal,
) {
  const payload = buildChatGptConversationPayload({
    prompt,
    messageId: transport.randomUUID(),
    model: transport.model,
    now: transport.now(),
  });
  const response = await transport.fetch(CHATGPT_CONVERSATION_URL, {
    method: "POST",
    headers: {
      ...context.commonHeaders,
      ...buildChatGptTargetHeaders("/backend-api/f/conversation"),
      accept: "text/event-stream",
      "oai-echo-logs": "",
      "openai-sentinel-chat-requirements-token": requirements.token,
      ...(requirements.proofToken ? { "openai-sentinel-proof-token": requirements.proofToken } : {}),
      "oai-telemetry": "[1,null]",
      "x-oai-turn-trace-id": transport.randomUUID(),
    },
    body: JSON.stringify(payload),
    signal: timeoutSignal(signal, transport.timeoutMs),
  });
  const rawText = await response.text();
  if (!response.ok)
    throw new Error(`ChatGPT conversation request failed with HTTP ${response.status}: ${rawText.slice(0, 300)}`);
  return parseChatGptConversationStream(rawText);
}

async function waitForGeneratedAssets(
  conversationId: string,
  context: AuthenticatedContext,
  transport: ChatGptDirectTransport,
  signal?: AbortSignal,
) {
  const started = Date.now();
  while (Date.now() - started < transport.timeoutMs) {
    const conversation = await fetchJson<unknown>(
      transport,
      `${CHATGPT_BASE_URL}/backend-api/conversation/${conversationId}`,
      {
        headers: {
          ...context.commonHeaders,
          ...buildChatGptTargetHeaders(
            `/backend-api/conversation/${conversationId}`,
            "/backend-api/conversation/{conversation_id}",
          ),
        },
        signal: timeoutSignal(signal, 60_000),
      },
    );
    const assets = extractChatGptGeneratedAssets(conversation);
    if (assets.length > 0) return assets;
    await transport.sleep(transport.pollIntervalMs, signal);
  }

  throw new Error("Timed out waiting for ChatGPT generated image assets.");
}

async function downloadGeneratedImage(
  conversationId: string,
  fileId: string,
  context: AuthenticatedContext,
  transport: ChatGptDirectTransport,
  signal?: AbortSignal,
): Promise<DownloadedChatGptImage> {
  const download = await fetchJson<{ download_url?: string }>(
    transport,
    `${CHATGPT_BASE_URL}/backend-api/files/download/${fileId}?conversation_id=${conversationId}&inline=false`,
    {
      headers: {
        ...context.commonHeaders,
        ...buildChatGptTargetHeaders("/backend-api/files/download/{file_id}"),
      },
      signal: timeoutSignal(signal, 60_000),
    },
  );
  if (!download.download_url) throw new Error("ChatGPT generated image download endpoint did not return download_url.");

  const response = await transport.fetchImage(download.download_url, {
    headers: { cookie: context.cookieHeader, "user-agent": CHATGPT_USER_AGENT, referer: `${CHATGPT_BASE_URL}/` },
    signal: timeoutSignal(signal, 90_000),
  });
  if (!response.ok) throw new Error(`ChatGPT generated image bytes download failed with HTTP ${response.status}.`);
  return { bytes: await readResponseBytes(response), contentType: response.headers.get("content-type") };
}

async function fetchText(transport: ChatGptDirectTransport, url: string, init: RequestInit): Promise<string> {
  const response = await transport.fetch(url, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} failed with HTTP ${response.status}: ${text.slice(0, 300)}`);
  return text;
}

async function fetchJson<T>(transport: ChatGptDirectTransport, url: string, init: RequestInit): Promise<T> {
  const text = await fetchText(transport, url, init);
  return JSON.parse(text) as T;
}

async function postJson<T>(
  transport: ChatGptDirectTransport,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return fetchJson<T>(transport, url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: timeoutSignal(signal, 60_000),
  });
}

async function readResponseBytes(response: ChatGptFetchResponse): Promise<Uint8Array> {
  try {
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (typeof response.bytes === "function") return response.bytes();
    throw error;
  }
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timeout);
      reject(new Error("ChatGPT direct image generation was aborted."));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
