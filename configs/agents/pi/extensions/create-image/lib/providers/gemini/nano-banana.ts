import { Impit } from "impit";
import type { GeneratedImage, ImageGenerationProvider, ImageGenerationRequest, ImageGenerationResult } from "../types";
import { type CookieMap, getGoogleCookies } from "./chrome-cookies";
import {
  buildCookieHeader,
  buildGeminiGeneratePayload,
  detectImageType,
  extractGeneratedImageRecords,
  GEMINI_APP_URL,
  GEMINI_GENERATE_URL,
  GEMINI_MODEL_HEADER_NAME,
  GEMINI_USER_AGENT,
  type GeminiGeneratedImageRecord,
  NANO_BANANA_MODEL_HEADER,
  parseGeminiResponseFrames,
  toGeminiImageDownloadUrl,
} from "./web-protocol";

const PROVIDER_ID = "nano-banana";
const PROVIDER_LABEL = "Nano Banana";
const DEFAULT_TIMEOUT_MS = 180_000;
const DOWNLOAD_TIMEOUT_MS = 90_000;
const GEMINI_RETRY_ATTEMPTS = 3;
const GEMINI_GENERATION_RETRY_ATTEMPTS = 2;
const GEMINI_RETRY_BACKOFF_MS = [500, 1_500];
const GEMINI_RETRYABLE_HTTP_STATUS = new Set([429, 500, 502, 503, 504]);
const REQUIRED_COOKIES = ["__Secure-1PSID", "__Secure-1PSIDTS"];

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

type ImpersonatedResponse = {
  ok: boolean;
  status: number;
  headers: Headers;
  bytes(): Promise<Uint8Array>;
};

export interface ImpersonatedFetchClient {
  fetch(url: string, init?: RequestInit): Promise<ImpersonatedResponse>;
}

export interface GeminiNanoBananaTransport {
  fetch: FetchLike;
  createImpersonatedClient: () => ImpersonatedFetchClient;
  getCookies: (profile?: string) => Promise<{ cookies: CookieMap; browser: string } | null>;
  randomUUID: () => string;
  nextRequestId: () => string;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

interface GeminiTextResponseSnapshot {
  status: number;
  contentType: string | null;
  body: string;
}

interface GeminiBytesResponseSnapshot {
  status: number;
  contentType: string | null;
  bytes: Uint8Array;
}

interface GeminiFetchOptions {
  label: string;
  signal?: AbortSignal;
  timeoutMs: number;
}

export function createGeminiNanoBananaProvider(
  transport: GeminiNanoBananaTransport = createDefaultGeminiNanoBananaTransport(),
): ImageGenerationProvider {
  return {
    id: PROVIDER_ID,
    aliases: ["gemini", "gemini-nano-banana", "nano banana"],
    label: PROVIDER_LABEL,
    async generate(request) {
      return generateWithGeminiNanoBanana(request, transport);
    },
  };
}

export function createDefaultGeminiNanoBananaTransport(): GeminiNanoBananaTransport {
  return {
    fetch: (url, init) => fetch(url, init),
    createImpersonatedClient: () => {
      const impit = new Impit({ browser: "chrome", timeout: DEFAULT_TIMEOUT_MS });
      return {
        fetch: (url, init) => impit.fetch(url, init as never) as Promise<ImpersonatedResponse>,
      };
    },
    getCookies: (profile) => getGoogleCookies({ profile, requiredCookies: REQUIRED_COOKIES }),
    randomUUID: () => crypto.randomUUID().toUpperCase(),
    nextRequestId: () => String(Math.floor(Math.random() * 900_000) + 100_000),
    sleep: (ms, signal) => sleep(ms, signal),
  };
}

export async function generateWithGeminiNanoBanana(
  request: ImageGenerationRequest,
  transport: GeminiNanoBananaTransport,
): Promise<ImageGenerationResult> {
  const cookieResult = await transport.getCookies(request.profile);
  if (!cookieResult) {
    throw new Error("Gemini Web cookies were not found. Sign into gemini.google.com in Brave, Chromium, or Chrome.");
  }

  const cookieHeader = buildCookieHeader(cookieResult.cookies);
  const accessToken = await fetchAccessToken(transport, cookieHeader, request.signal);
  const generatedRecords = await requestGeneratedImages(
    request.prompt,
    accessToken,
    cookieHeader,
    transport,
    request.signal,
  );

  const imageClient = transport.createImpersonatedClient();
  const images: GeneratedImage[] = [];
  for (const record of generatedRecords) {
    images.push(await downloadGeneratedImage(record, imageClient, cookieHeader, transport, request.signal));
  }

  return { providerId: PROVIDER_ID, providerLabel: PROVIDER_LABEL, images };
}

async function fetchAccessToken(
  transport: GeminiNanoBananaTransport,
  cookieHeader: string,
  signal?: AbortSignal,
): Promise<string> {
  return retryGeminiNanoBanana(transport, signal, async () => {
    const snapshot = await fetchTextOnce(
      transport,
      GEMINI_APP_URL,
      {
        headers: { cookie: cookieHeader, "user-agent": GEMINI_USER_AGENT },
        redirect: "follow",
      },
      { label: "app bootstrap", signal, timeoutMs: 30_000 },
    );

    for (const key of ["SNlM0e", "thykhd"]) {
      const match = snapshot.body.match(new RegExp(`"${key}":"(.*?)"`));
      if (match?.[1]) return match[1];
    }

    throw new GeminiNanoBananaResponseError(
      `Unable to authenticate with Gemini Web. Sign into gemini.google.com in Brave, Chromium, or Chrome. ${formatTextResponseDiagnostics(
        GEMINI_APP_URL,
        snapshot,
      )}.`,
      true,
    );
  });
}

async function requestGeneratedImages(
  prompt: string,
  accessToken: string,
  cookieHeader: string,
  transport: GeminiNanoBananaTransport,
  signal?: AbortSignal,
): Promise<GeminiGeneratedImageRecord[]> {
  return retryGeminiNanoBanana(
    transport,
    signal,
    async () => {
      const requestUuid = transport.randomUUID();
      const params = new URLSearchParams({ hl: "en", _reqid: transport.nextRequestId(), rt: "c" });
      const url = `${GEMINI_GENERATE_URL}?${params.toString()}`;
      const snapshot = await fetchTextOnce(
        transport,
        url,
        {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded;charset=utf-8",
            origin: "https://gemini.google.com",
            referer: "https://gemini.google.com/",
            "x-same-domain": "1",
            "user-agent": GEMINI_USER_AGENT,
            cookie: cookieHeader,
            [GEMINI_MODEL_HEADER_NAME]: NANO_BANANA_MODEL_HEADER,
            "x-goog-ext-73010989-jspb": "[0]",
            "x-goog-ext-73010990-jspb": "[0]",
            "x-goog-ext-525005358-jspb": `["${requestUuid}",1]`,
          },
          body: new URLSearchParams({
            at: accessToken,
            "f.req": buildGeminiGeneratePayload(prompt, requestUuid),
          }),
        },
        { label: "image generation", signal, timeoutMs: DEFAULT_TIMEOUT_MS },
      );

      let records: GeminiGeneratedImageRecord[];
      try {
        records = extractGeneratedImageRecords(parseGeminiResponseFrames(snapshot.body));
      } catch (error) {
        throw new GeminiNanoBananaResponseError(
          `Gemini Web image generation returned an unparsable response: ${formatTextResponseDiagnostics(
            url,
            snapshot,
          )}. Parse error: ${formatErrorMessage(error)}.`,
          true,
        );
      }

      if (records.length === 0) {
        throw new GeminiNanoBananaResponseError(
          `Gemini Web did not return a generated image. Try wording the prompt with 'generate an image'. ${formatTextResponseDiagnostics(
            url,
            snapshot,
          )}.`,
          true,
        );
      }

      return records;
    },
    GEMINI_GENERATION_RETRY_ATTEMPTS,
  );
}

async function downloadGeneratedImage(
  record: GeminiGeneratedImageRecord,
  imageClient: ImpersonatedFetchClient,
  cookieHeader: string,
  transport: GeminiNanoBananaTransport,
  signal?: AbortSignal,
): Promise<GeneratedImage> {
  const downloadUrl = toGeminiImageDownloadUrl(record.url);
  return retryGeminiNanoBanana(transport, signal, async () => {
    const response = await imageClient.fetch(downloadUrl, {
      headers: {
        cookie: cookieHeader,
        referer: "https://gemini.google.com/",
      },
      signal: timeoutSignal(signal, DOWNLOAD_TIMEOUT_MS),
    });
    const snapshot = await readImpersonatedResponseBytes(downloadUrl, response);
    if (!response.ok) {
      throw new GeminiNanoBananaResponseError(
        `Generated image download failed: ${formatBytesResponseDiagnostics(downloadUrl, snapshot)}.`,
        GEMINI_RETRYABLE_HTTP_STATUS.has(response.status),
      );
    }

    const detected = detectImageType(snapshot.bytes);
    if (!detected) {
      throw new GeminiNanoBananaResponseError(
        `Generated image download did not return recognized image bytes: ${formatBytesResponseDiagnostics(
          downloadUrl,
          snapshot,
        )}.`,
        true,
      );
    }

    return { ...detected, bytes: snapshot.bytes, providerImageId: record.imageId };
  });
}

async function fetchTextOnce(
  transport: GeminiNanoBananaTransport,
  url: string,
  init: RequestInit,
  options: GeminiFetchOptions,
): Promise<GeminiTextResponseSnapshot> {
  const response = await transport.fetch(url, { ...init, signal: timeoutSignal(options.signal, options.timeoutMs) });
  const body = await response.text();
  const snapshot = { status: response.status, contentType: response.headers.get("content-type"), body };
  if (!response.ok) {
    throw new GeminiNanoBananaResponseError(
      `Gemini Web ${options.label} failed: ${formatTextResponseDiagnostics(url, snapshot)}.`,
      GEMINI_RETRYABLE_HTTP_STATUS.has(response.status),
    );
  }
  return snapshot;
}

async function readImpersonatedResponseBytes(
  url: string,
  response: ImpersonatedResponse,
): Promise<GeminiBytesResponseSnapshot> {
  try {
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      bytes: await response.bytes(),
    };
  } catch (error) {
    throw new GeminiNanoBananaResponseError(
      `Generated image download body read failed for ${formatUrlLocation(url)}: ${formatErrorMessage(error)}.`,
      true,
    );
  }
}

async function retryGeminiNanoBanana<T>(
  transport: GeminiNanoBananaTransport,
  signal: AbortSignal | undefined,
  run: () => Promise<T>,
  attempts = GEMINI_RETRY_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !shouldRetryGeminiNanoBananaError(error, signal)) throw error;
      await transport.sleep(GEMINI_RETRY_BACKOFF_MS[attempt - 1] ?? 0, signal);
    }
  }

  throw new Error("Gemini Nano Banana retry loop exited unexpectedly.");
}

function shouldRetryGeminiNanoBananaError(error: unknown, signal: AbortSignal | undefined): boolean {
  if (signal?.aborted) return false;
  if (error instanceof GeminiNanoBananaResponseError) return error.retryable;
  return true;
}

class GeminiNanoBananaResponseError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "GeminiNanoBananaResponseError";
  }
}

function formatTextResponseDiagnostics(url: string, snapshot: GeminiTextResponseSnapshot): string {
  return [
    `path ${safeUrlPath(url)}`,
    `HTTP ${snapshot.status}`,
    `content-type ${snapshot.contentType ?? "unknown"}`,
    `body length ${snapshot.body.length}`,
    `snippet ${JSON.stringify(redactDiagnosticSnippet(snapshot.body))}`,
  ].join(", ");
}

function formatBytesResponseDiagnostics(url: string, snapshot: GeminiBytesResponseSnapshot): string {
  return [
    `location ${formatUrlLocation(url)}`,
    `HTTP ${snapshot.status}`,
    `content-type ${snapshot.contentType ?? "unknown"}`,
    `byte length ${snapshot.bytes.length}`,
    `magic ${Buffer.from(snapshot.bytes.slice(0, 16)).toString("hex") || "empty"}`,
    `snippet ${JSON.stringify(redactDiagnosticSnippet(Buffer.from(snapshot.bytes.slice(0, 200)).toString("utf8")))}`,
  ].join(", ");
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

function formatUrlLocation(url: string): string {
  try {
    const parsed = new URL(url);
    const pathPrefix = parsed.pathname.length > 80 ? `${parsed.pathname.slice(0, 80)}…` : parsed.pathname;
    return `${parsed.host}${pathPrefix}`;
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
    const timeout = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timeout);
      reject(new Error("Gemini Nano Banana image generation was aborted."));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
