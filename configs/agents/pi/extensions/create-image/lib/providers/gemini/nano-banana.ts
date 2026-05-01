import { Impit } from "impit";
import type { ImageGenerationProvider, ImageGenerationRequest, ImageGenerationResult } from "../types";
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
  NANO_BANANA_MODEL_HEADER,
  parseGeminiResponseFrames,
  toGeminiImageDownloadUrl,
} from "./web-protocol";

const PROVIDER_ID = "nano-banana";
const PROVIDER_LABEL = "Nano Banana";
const DEFAULT_TIMEOUT_MS = 180_000;
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
  const accessToken = await fetchAccessToken(transport.fetch, cookieHeader, request.signal);
  const generatedRecords = await requestGeneratedImages(
    request.prompt,
    accessToken,
    cookieHeader,
    transport,
    request.signal,
  );
  if (generatedRecords.length === 0) {
    throw new Error("Gemini Web did not return a generated image. Try wording the prompt with 'generate an image'.");
  }

  const imageClient = transport.createImpersonatedClient();
  const images = [];
  for (const record of generatedRecords) {
    const response = await imageClient.fetch(toGeminiImageDownloadUrl(record.url), {
      headers: {
        cookie: cookieHeader,
        referer: "https://gemini.google.com/",
      },
      signal: request.signal,
    });
    if (!response.ok) throw new Error(`Generated image download failed with HTTP ${response.status}.`);

    const bytes = await response.bytes();
    const detected = detectImageType(bytes);
    if (!detected) throw new Error("Generated image download did not return recognized image bytes.");

    images.push({ ...detected, bytes, providerImageId: record.imageId });
  }

  return { providerId: PROVIDER_ID, providerLabel: PROVIDER_LABEL, images };
}

async function fetchAccessToken(fetchImpl: FetchLike, cookieHeader: string, signal?: AbortSignal): Promise<string> {
  const response = await fetchImpl(GEMINI_APP_URL, {
    headers: { cookie: cookieHeader, "user-agent": GEMINI_USER_AGENT },
    redirect: "follow",
    signal: timeoutSignal(signal, 30_000),
  });
  const html = await response.text();
  for (const key of ["SNlM0e", "thykhd"]) {
    const match = html.match(new RegExp(`"${key}":"(.*?)"`));
    if (match?.[1]) return match[1];
  }
  throw new Error("Unable to authenticate with Gemini Web. Sign into gemini.google.com in Brave, Chromium, or Chrome.");
}

async function requestGeneratedImages(
  prompt: string,
  accessToken: string,
  cookieHeader: string,
  transport: GeminiNanoBananaTransport,
  signal?: AbortSignal,
) {
  const requestUuid = transport.randomUUID();
  const params = new URLSearchParams({ hl: "en", _reqid: transport.nextRequestId(), rt: "c" });
  const response = await transport.fetch(`${GEMINI_GENERATE_URL}?${params.toString()}`, {
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
    signal: timeoutSignal(signal, DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`Gemini Web image generation failed with HTTP ${response.status}.`);
  const rawText = await response.text();
  return extractGeneratedImageRecords(parseGeminiResponseFrames(rawText));
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
