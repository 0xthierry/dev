import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { loadConfig, normalizedString } from "../config";
import { type CookieMap, getGoogleCookies } from "./chrome-cookies";

const GEMINI_APP_URL = "https://gemini.google.com/app";
const GEMINI_STREAM_GENERATE_URL =
  "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
const GEMINI_UPLOAD_URL = "https://content-push.googleapis.com/upload";
const GEMINI_UPLOAD_PUSH_ID = "feeds/mcudyrk2a4khkz";
const REQUIRED_COOKIES = ["__Secure-1PSID", "__Secure-1PSIDTS"];
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MODEL_HEADER_NAME = "x-goog-ext-525001261-jspb";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const EMPTY_TEXT = "";
const MODEL_HEADERS: Record<string, string> = {
  "gemini-3-pro": '[1,null,null,null,"9d8ca3786ebdfbea",null,null,0,[4]]',
  "gemini-2.5-pro": '[1,null,null,null,"4af6c7f5da75d65d",null,null,0,[4]]',
  "gemini-2.5-flash": '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
  "gemini-3-flash-preview": '[1,null,null,null,"9ec249fc9ad08861",null,null,0,[4]]',
};

export interface GeminiWebOptions {
  youtubeUrl?: string;
  model?: string;
  files?: string[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function isGeminiWebAvailable(profile?: string): Promise<CookieMap | null> {
  const config = loadConfig();
  const configuredProfile =
    normalizedString(profile) ?? normalizedString(config.braveProfile) ?? normalizedString(config.chromeProfile);
  const result = await getGoogleCookies({ profile: configuredProfile, requiredCookies: REQUIRED_COOKIES });
  return result?.cookies ?? null;
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function buildCookieHeader(cookies: CookieMap): string {
  return Object.entries(cookies)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

export async function queryWithCookies(
  prompt: string,
  cookieMap: CookieMap,
  options: GeminiWebOptions = {},
): Promise<string> {
  const model = options.model && MODEL_HEADERS[options.model] ? options.model : DEFAULT_GEMINI_MODEL;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const fullPrompt = options.youtubeUrl ? `${prompt}\n\nYouTube video: ${options.youtubeUrl}` : prompt;
  const result = await runGeminiWebOnce(fullPrompt, cookieMap, model, options.files, timeoutMs, options.signal);
  if (result.errorMessage) throw new Error(result.errorMessage);
  if (!result.text) throw new Error("Gemini Web returned empty response");
  return result.text;
}

async function runGeminiWebOnce(
  prompt: string,
  cookieMap: CookieMap,
  model: string,
  files: string[] | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ text: string; errorMessage?: string }> {
  const effectiveSignal = withTimeout(signal, timeoutMs);
  const cookieHeader = buildCookieHeader(cookieMap);
  const accessToken = await fetchAccessToken(cookieHeader, effectiveSignal);
  const uploaded: Array<{ id: string; name: string }> = [];
  if (files) {
    for (const filePath of files) uploaded.push(await uploadFile(filePath, cookieHeader, effectiveSignal));
  }

  const params = new URLSearchParams();
  params.set("at", accessToken);
  params.set("f.req", buildFReqPayload(prompt, uploaded));

  const response = await fetch(GEMINI_STREAM_GENERATE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=utf-8",
      host: "gemini.google.com",
      origin: "https://gemini.google.com",
      referer: "https://gemini.google.com/",
      "x-same-domain": "1",
      "user-agent": USER_AGENT,
      cookie: cookieHeader,
      [MODEL_HEADER_NAME]: MODEL_HEADERS[model] ?? MODEL_HEADERS[DEFAULT_GEMINI_MODEL],
    },
    body: params.toString(),
    signal: effectiveSignal,
  });

  const rawText = await response.text();
  if (!response.ok) return { text: EMPTY_TEXT, errorMessage: `Gemini request failed: ${response.status}` };
  try {
    return { text: parseStreamGenerateResponse(rawText) };
  } catch (err) {
    return { text: EMPTY_TEXT, errorMessage: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchAccessToken(cookieHeader: string, signal: AbortSignal): Promise<string> {
  const html = await fetchWithCookieRedirects(GEMINI_APP_URL, cookieHeader, 10, signal);
  for (const key of ["SNlM0e", "thykhd"]) {
    const match = html.match(new RegExp(`"${key}":"(.*?)"`));
    if (match?.[1]) return match[1];
  }
  throw new Error("Unable to authenticate with Gemini. Sign into gemini.google.com in Brave or Chromium.");
}

async function fetchWithCookieRedirects(
  url: string,
  cookieHeader: string,
  maxRedirects: number,
  signal: AbortSignal,
): Promise<string> {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    const response = await fetch(current, {
      headers: { "user-agent": USER_AGENT, cookie: cookieHeader },
      redirect: "manual",
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        current = new URL(location, current).toString();
        continue;
      }
    }
    return response.text();
  }
  throw new Error("Too many Gemini redirects");
}

async function uploadFile(
  filePath: string,
  cookieHeader: string,
  signal: AbortSignal,
): Promise<{ id: string; name: string }> {
  if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const buffer = readFileSync(filePath);
  const name = basename(filePath);
  const response = await fetch(`${GEMINI_UPLOAD_URL}/${GEMINI_UPLOAD_PUSH_ID}?upload_protocol=raw`, {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "user-agent": USER_AGENT,
      cookie: cookieHeader,
      "x-goog-upload-file-name": encodeURIComponent(name),
    },
    body: buffer,
    signal,
  });
  if (!response.ok) throw new Error(`Gemini file upload failed: ${response.status}`);
  return { id: await response.text(), name };
}

function buildFReqPayload(prompt: string, uploaded: Array<{ id: string; name: string }>): string {
  const promptPayload = uploaded.length > 0 ? [prompt, 0, null, uploaded.map((file) => [[file.id, 1]])] : [prompt];
  const innerList = [promptPayload, null, null];
  return JSON.stringify([null, JSON.stringify(innerList)]);
}

function getNestedValue(value: unknown, pathParts: number[]): unknown {
  let current = value;
  for (const part of pathParts) {
    if (!Array.isArray(current)) return undefined;
    current = current[part];
  }
  return current;
}

function trimJsonEnvelope(rawText: string): string {
  const start = rawText.indexOf("[");
  const end = rawText.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Gemini response did not contain a JSON payload.");
  }
  return rawText.slice(start, end + 1);
}

export function parseStreamGenerateResponse(rawText: string): string {
  const responseJson = JSON.parse(trimJsonEnvelope(rawText)) as unknown;
  const parts = Array.isArray(responseJson) ? responseJson : [];
  let text = "";

  for (const part of parts) {
    const partBody = getNestedValue(part, [2]);
    if (!partBody || typeof partBody !== "string") continue;
    try {
      const parsed = JSON.parse(partBody) as unknown;
      const candidateList = getNestedValue(parsed, [4]);
      if (!Array.isArray(candidateList)) continue;
      for (const candidate of candidateList) {
        const candidateText = extractCandidateText(candidate);
        if (candidateText.length >= text.length) text = candidateText;
      }
    } catch {}
  }

  if (!text) throw new Error("Gemini Web response did not include text content");
  return text.trim();
}

function extractCandidateText(candidate: unknown): string {
  let text = (getNestedValue(candidate, [1, 0]) as string | undefined) ?? EMPTY_TEXT;
  const contentParts = getNestedValue(candidate, [1]);
  if (Array.isArray(contentParts)) {
    const flattened = flattenStrings(contentParts).join("").trim();
    if (flattened.length > text.trim().length) text = flattened;
  }
  if (/^http:\/\/googleusercontent\.com\/card_content\/\d+/.test(text)) {
    text = (getNestedValue(candidate, [22, 0]) as string | undefined) ?? text;
  }
  if (text.trim().length < 10) {
    const candidates: string[] = [];
    collectStrings(candidate, candidates);
    text =
      candidates
        .map((item) => item.trim())
        .filter((item) => item.length > text.trim().length)
        .filter((item) => !item.includes("BardFrontendService") && !item.includes("wrb.fr"))
        .filter((item) => !/^rc_[a-f0-9]+$/i.test(item))
        .filter((item) => !/^https?:\/\//.test(item))
        .sort((a, b) => b.length - a.length)[0] ?? text;
  }
  return text.trim();
}

function flattenStrings(value: unknown): string[] {
  const strings: string[] = [];
  collectStrings(value, strings);
  return strings;
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        collectStrings(JSON.parse(trimmed) as unknown, out);
        return;
      } catch {}
    }
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  }
}
