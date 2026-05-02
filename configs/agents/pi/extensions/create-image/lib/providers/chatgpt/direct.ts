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
const CHATGPT_DIRECT_RETRY_ATTEMPTS = 3;
const CHATGPT_DIRECT_RETRY_BACKOFF_MS = [500, 1_500];
const CHATGPT_RETRYABLE_HTTP_STATUS = new Set([429, 502, 503, 504]);
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

interface ChatGptTextResponseSnapshot {
  status: number;
  contentType: string | null;
  body: string;
}

interface ChatGptFetchOptions {
  label: string;
  signal?: AbortSignal;
  timeoutMs: number;
  fetchImage?: boolean;
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
  const homeHeaders = { cookie: cookieHeader, "user-agent": CHATGPT_USER_AGENT, referer: `${CHATGPT_BASE_URL}/` };
  const build = await fetchChatGptBuildInfo(transport, `${CHATGPT_BASE_URL}/`, { headers: homeHeaders }, signal);
  const session = await fetchJson<ChatGptSession>(
    transport,
    CHATGPT_AUTH_SESSION_URL,
    { headers: homeHeaders },
    { label: "auth session", signal, timeoutMs: 60_000 },
  );
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
    { label: "chat requirements prepare", signal },
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
    { label: "chat requirements finalize", signal },
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
  const stream = parseChatGptConversationStream(rawText);
  if (!response.ok && !stream.conversationId) {
    throw new Error(
      `ChatGPT conversation request failed: ${formatResponseDiagnostics(CHATGPT_CONVERSATION_URL, {
        status: response.status,
        contentType: response.headers.get("content-type"),
        body: rawText,
      })}.`,
    );
  }
  return stream;
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
      },
      { label: "conversation poll", signal, timeoutMs: 60_000 },
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
    },
    { label: "generated image download metadata", signal, timeoutMs: 60_000 },
  );
  if (!download.download_url) throw new Error("ChatGPT generated image download endpoint did not return download_url.");

  const response = await fetchResponseBytesWithRetry(
    transport,
    download.download_url,
    { headers: { cookie: context.cookieHeader, "user-agent": CHATGPT_USER_AGENT, referer: `${CHATGPT_BASE_URL}/` } },
    { label: "generated image bytes", signal, timeoutMs: 90_000, fetchImage: true },
  );
  return { bytes: response.bytes, contentType: response.contentType };
}

async function fetchChatGptBuildInfo(
  transport: ChatGptDirectTransport,
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<ChatGptBuildInfo> {
  return retryChatGptDirect(transport, signal, async () => {
    const snapshot = await fetchTextOnce(transport, url, init, { label: "home HTML", signal, timeoutMs: 60_000 });
    try {
      return extractChatGptBuildInfo(snapshot.body);
    } catch (error) {
      throw new ChatGptDirectResponseError(
        `ChatGPT home HTML did not include build metadata: ${formatResponseDiagnostics(url, snapshot, {
          includeHtmlMetadata: true,
        })}. Parse error: ${formatErrorMessage(error)}.`,
        true,
      );
    }
  });
}

async function fetchJson<T>(
  transport: ChatGptDirectTransport,
  url: string,
  init: RequestInit,
  options: ChatGptFetchOptions,
): Promise<T> {
  return retryChatGptDirect(transport, options.signal, async () => {
    const snapshot = await fetchTextOnce(transport, url, init, options);
    try {
      return JSON.parse(snapshot.body) as T;
    } catch (error) {
      throw new ChatGptDirectResponseError(
        `ChatGPT ${options.label} returned invalid JSON: ${formatResponseDiagnostics(url, snapshot)}. Parse error: ${formatErrorMessage(error)}.`,
        true,
      );
    }
  });
}

async function postJson<T>(
  transport: ChatGptDirectTransport,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: { label: string; signal?: AbortSignal },
): Promise<T> {
  return fetchJson<T>(
    transport,
    url,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
    { label: options.label, signal: options.signal, timeoutMs: 60_000 },
  );
}

async function fetchTextOnce(
  transport: ChatGptDirectTransport,
  url: string,
  init: RequestInit,
  options: ChatGptFetchOptions,
): Promise<ChatGptTextResponseSnapshot> {
  const response = await fetchWithAttemptSignal(transport, url, init, options);
  const body = await response.text();
  const snapshot = { status: response.status, contentType: response.headers.get("content-type"), body };
  if (!response.ok) {
    throw new ChatGptDirectResponseError(
      `ChatGPT ${options.label} failed: ${formatResponseDiagnostics(url, snapshot)}.`,
      CHATGPT_RETRYABLE_HTTP_STATUS.has(response.status),
    );
  }
  return snapshot;
}

async function fetchResponseBytesWithRetry(
  transport: ChatGptDirectTransport,
  url: string,
  init: RequestInit,
  options: ChatGptFetchOptions,
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
  return retryChatGptDirect(transport, options.signal, async () => {
    const response = await fetchWithAttemptSignal(transport, url, init, options);
    if (!response.ok) {
      const body = await response.text();
      throw new ChatGptDirectResponseError(
        `ChatGPT ${options.label} failed: ${formatResponseDiagnostics(url, {
          status: response.status,
          contentType: response.headers.get("content-type"),
          body,
        })}.`,
        CHATGPT_RETRYABLE_HTTP_STATUS.has(response.status),
      );
    }
    return { bytes: await readResponseBytes(response), contentType: response.headers.get("content-type") };
  });
}

function fetchWithAttemptSignal(
  transport: ChatGptDirectTransport,
  url: string,
  init: RequestInit,
  options: ChatGptFetchOptions,
): Promise<ChatGptFetchResponse> {
  const fetcher = options.fetchImage ? transport.fetchImage : transport.fetch;
  return fetcher(url, { ...init, signal: timeoutSignal(options.signal, options.timeoutMs) });
}

async function retryChatGptDirect<T>(
  transport: ChatGptDirectTransport,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= CHATGPT_DIRECT_RETRY_ATTEMPTS; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= CHATGPT_DIRECT_RETRY_ATTEMPTS || !shouldRetryChatGptDirectError(error, signal)) throw error;
      await transport.sleep(CHATGPT_DIRECT_RETRY_BACKOFF_MS[attempt - 1] ?? 0, signal);
    }
  }

  throw new Error("ChatGPT direct retry loop exited unexpectedly.");
}

function shouldRetryChatGptDirectError(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return false;
  if (error instanceof ChatGptDirectResponseError) return error.retryable;
  return true;
}

class ChatGptDirectResponseError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ChatGptDirectResponseError";
  }
}

function formatResponseDiagnostics(
  url: string,
  snapshot: ChatGptTextResponseSnapshot,
  options: { includeHtmlMetadata?: boolean } = {},
): string {
  const diagnostics = [
    `path ${safeUrlPath(url)}`,
    `HTTP ${snapshot.status}`,
    `content-type ${snapshot.contentType ?? "unknown"}`,
    `body length ${snapshot.body.length}`,
    `snippet ${JSON.stringify(redactDiagnosticSnippet(snapshot.body))}`,
  ];
  if (options.includeHtmlMetadata) {
    const lowerBody = snapshot.body.toLowerCase();
    diagnostics.push(`contains <html: ${lowerBody.includes("<html") ? "yes" : "no"}`);
    diagnostics.push(`contains data-build: ${/\bdata-build\b/i.test(snapshot.body) ? "yes" : "no"}`);
  }
  return diagnostics.join(", ");
}

function redactDiagnosticSnippet(body: string): string {
  return body
    .slice(0, 1_000)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted-jwt]")
    .replace(/\b[A-Za-z0-9_+/=-]{64,}\b/g, "[redacted-token]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function safeUrlPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "[unparseable-url]";
  }
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
