import { Impit } from "impit";
import type { NormalizedChatGptOracleConfig } from "../../config";
import { isOracleSessionStateCompatible, type OracleSessionState } from "../../session";
import { type CookieMap, getChatGptCookies } from "./browser-cookies";
import { extractOracleConversationText, type OracleTurnScope } from "./conversation";
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
  extractChatGptBuildInfo,
  generateChatGptProofToken,
  parseChatGptConversationStream,
} from "./direct-protocol";

const CHATGPT_DIRECT_RETRY_ATTEMPTS = 3;
const CHATGPT_DIRECT_RETRY_BACKOFF_MS = [500, 1_500];
const CHATGPT_RETRYABLE_HTTP_STATUS = new Set([429, 502, 503, 504]);

type FetchLike = (url: string, init?: RequestInit) => Promise<ChatGptFetchResponse>;

type ChatGptFetchResponse = Response & {
  bytes?: () => Promise<Uint8Array>;
};

export interface OracleAskRequest {
  prompt: string;
  config: NormalizedChatGptOracleConfig;
  signal?: AbortSignal;
  state?: OracleSessionState;
}

export interface OracleAnswer {
  providerId: "chatgpt-web";
  providerLabel: "ChatGPT Web";
  model: string;
  conversationId: string;
  messageId?: string;
  currentNode?: string;
  projectId?: string;
  status?: string;
  finished: boolean;
  resumed: boolean;
  text: string;
}

export interface ChatGptOracleTransport {
  fetch: FetchLike;
  getCookies: typeof getChatGptCookies;
  randomUUID: () => string;
  random: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
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

interface ChatGptTextResponseSnapshot {
  status: number;
  contentType: string | null;
  body: string;
}

interface ChatGptFetchOptions {
  label: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

export function createDefaultChatGptOracleTransport(timeoutMs: number): ChatGptOracleTransport {
  const impit = new Impit({ browser: "chrome", timeout: timeoutMs });
  return {
    fetch: (url, init) => impit.fetch(url, init as never) as unknown as Promise<ChatGptFetchResponse>,
    getCookies: getChatGptCookies,
    randomUUID: () => crypto.randomUUID(),
    random: () => Math.random(),
    sleep: (ms, signal) => sleep(ms, signal),
  };
}

export async function askChatGptOracle(
  request: OracleAskRequest,
  transport: ChatGptOracleTransport = createDefaultChatGptOracleTransport(request.config.timeoutMs),
): Promise<OracleAnswer> {
  const cookieResult = await transport.getCookies({ browser: request.config.browser, profile: request.config.profile });
  if (!cookieResult) {
    throw new Error(
      `ChatGPT Web cookies were not found for ${request.config.browser} profile ${JSON.stringify(
        request.config.profile,
      )}. Sign into chatgpt.com in that browser profile or update ~/.pi/oracle.json.`,
    );
  }

  const conversationState = isOracleSessionStateCompatible(request.state, request.config.projectId)
    ? request.state
    : undefined;
  const context = await createAuthenticatedContext(cookieResult.cookies, request, transport);
  const finalizedRequirements = await fetchFinalizedRequirements(context, request, transport);
  const stream = await sendConversationRequest(
    request.prompt,
    conversationState,
    context,
    finalizedRequirements,
    request,
    transport,
  );
  const conversationId = stream.conversationId ?? conversationState?.conversationId;
  if (!conversationId) throw new Error("ChatGPT did not return a conversation id for the oracle request.");

  const turnScope: OracleTurnScope = stream.turnExchangeId
    ? { kind: "pro", turnExchangeId: stream.turnExchangeId }
    : { kind: "instant", requestMessageId: stream.requestMessageId };
  const answer = await waitForOracleAnswer(conversationId, turnScope, context, request, transport);
  const currentNode = answer.currentNode ?? answer.messageId;
  if (!currentNode) throw new Error("ChatGPT conversation poll did not return a current node for resuming.");
  if (!answer.model) throw new Error("ChatGPT conversation poll did not report the model used for the Oracle answer.");
  if (answer.model !== request.config.model) {
    throw new Error(
      `ChatGPT used model ${JSON.stringify(answer.model)} instead of configured Oracle model ${JSON.stringify(request.config.model)}.`,
    );
  }
  return {
    providerId: "chatgpt-web",
    providerLabel: "ChatGPT Web",
    model: answer.model,
    conversationId,
    messageId: answer.messageId,
    currentNode,
    projectId: request.config.projectId,
    status: answer.status,
    finished: answer.finished,
    resumed: Boolean(conversationState),
    text: answer.text || stream.text.trim(),
  };
}

async function createAuthenticatedContext(
  cookies: CookieMap,
  request: OracleAskRequest,
  transport: ChatGptOracleTransport,
): Promise<AuthenticatedContext> {
  const cookieHeader = buildChatGptCookieHeader(cookies);
  const homeHeaders = {
    cookie: cookieHeader,
    "user-agent": CHATGPT_USER_AGENT,
    referer: chatGptReferer(request.config.projectId),
  };
  const build = await fetchChatGptBuildInfo(transport, `${CHATGPT_BASE_URL}/`, { headers: homeHeaders }, request);
  const session = await fetchJson<ChatGptSession>(
    transport,
    CHATGPT_AUTH_SESSION_URL,
    { headers: homeHeaders },
    { label: "auth session", signal: request.signal, timeoutMs: 60_000 },
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
  commonHeaders.referer = chatGptReferer(request.config.projectId);

  return { cookieHeader, accessToken: session.accessToken, build, commonHeaders };
}

async function fetchFinalizedRequirements(
  context: AuthenticatedContext,
  request: OracleAskRequest,
  transport: ChatGptOracleTransport,
): Promise<FinalizedRequirementsContext> {
  const proofOptions = {
    userAgent: CHATGPT_USER_AGENT,
    clientVersion: context.build.clientVersion,
    scriptUrls: context.build.scriptUrls,
    random: transport.random,
    randomUUID: transport.randomUUID,
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
    { label: "chat requirements prepare", signal: request.signal },
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
    { label: "chat requirements finalize", signal: request.signal },
  );
  if (!finalized.token) throw new Error("ChatGPT Sentinel did not return a chat requirements token.");
  return { token: finalized.token, proofToken };
}

async function sendConversationRequest(
  prompt: string,
  conversationState: OracleSessionState | undefined,
  context: AuthenticatedContext,
  requirements: FinalizedRequirementsContext,
  request: OracleAskRequest,
  transport: ChatGptOracleTransport,
) {
  const requestMessageId = transport.randomUUID();
  const payload = buildChatGptConversationPayload({
    prompt,
    conversationId: conversationState?.conversationId,
    parentMessageId: conversationState?.currentNode,
    messageId: requestMessageId,
    model: request.config.model,
    now: new Date(),
    projectId: request.config.projectId,
  });
  const response = await transport.fetch(CHATGPT_CONVERSATION_URL, {
    method: "POST",
    headers: {
      ...context.commonHeaders,
      ...buildChatGptTargetHeaders("/backend-api/f/conversation"),
      referer: chatGptReferer(request.config.projectId),
      accept: "text/event-stream",
      "oai-echo-logs": "",
      "openai-sentinel-chat-requirements-token": requirements.token,
      ...(requirements.proofToken ? { "openai-sentinel-proof-token": requirements.proofToken } : {}),
      "oai-telemetry": "[1,null]",
      "x-oai-turn-trace-id": transport.randomUUID(),
    },
    body: JSON.stringify(payload),
    signal: timeoutSignal(request.signal, request.config.timeoutMs),
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
  return { ...stream, requestMessageId };
}

async function waitForOracleAnswer(
  conversationId: string,
  turnScope: OracleTurnScope,
  context: AuthenticatedContext,
  request: OracleAskRequest,
  transport: ChatGptOracleTransport,
) {
  const started = Date.now();
  while (Date.now() - started < request.config.timeoutMs) {
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
      { label: "conversation poll", signal: request.signal, timeoutMs: 60_000 },
    );
    const answer = extractOracleConversationText(conversation, turnScope);
    if (answer) return answer;
    await transport.sleep(request.config.pollIntervalMs, request.signal);
  }

  throw new Error("Timed out waiting for the complete ChatGPT Oracle answer.");
}

async function fetchChatGptBuildInfo(
  transport: ChatGptOracleTransport,
  url: string,
  init: RequestInit,
  request: OracleAskRequest,
): Promise<ChatGptBuildInfo> {
  return retryChatGptDirect(transport, request.signal, async () => {
    const snapshot = await fetchTextOnce(transport, url, init, {
      label: "home HTML",
      signal: request.signal,
      timeoutMs: 60_000,
    });
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
  transport: ChatGptOracleTransport,
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
        `ChatGPT ${options.label} returned invalid JSON: ${formatResponseDiagnostics(
          url,
          snapshot,
        )}. Parse error: ${formatErrorMessage(error)}.`,
        true,
      );
    }
  });
}

async function postJson<T>(
  transport: ChatGptOracleTransport,
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
  transport: ChatGptOracleTransport,
  url: string,
  init: RequestInit,
  options: ChatGptFetchOptions,
): Promise<ChatGptTextResponseSnapshot> {
  const response = await transport.fetch(url, { ...init, signal: timeoutSignal(options.signal, options.timeoutMs) });
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

async function retryChatGptDirect<T>(
  transport: ChatGptOracleTransport,
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

function chatGptReferer(projectId: string | undefined): string {
  return projectId ? `${CHATGPT_BASE_URL}/g/${projectId}` : `${CHATGPT_BASE_URL}/`;
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

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      clearTimeout(timeout);
      reject(new Error("ChatGPT oracle request was aborted."));
    };
    const timeout = setTimeout(done, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}
