export const GEMINI_APP_URL = "https://gemini.google.com/app";
export const GEMINI_GENERATE_URL =
  "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate";
export const GEMINI_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
export const GEMINI_MODEL_HEADER_NAME = "x-goog-ext-525001261-jspb";
export const NANO_BANANA_MODEL_HEADER = '[1,null,null,null,"fbb127bbb056c959",null,null,0,[4],null,null,1]';

const DEFAULT_METADATA = ["", "", "", null, null, null, null, null, null, ""];
const TEMPORARY_CHAT_FLAG_INDEX = 45;

export interface GeminiGeneratedImageRecord {
  url: string;
  imageId?: string;
  alt?: string;
  cid?: string;
  rid?: string;
  rcid?: string;
}

export interface DetectedImageType {
  mimeType: string;
  extension: string;
}

export function buildCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .filter((entry): entry is [string, string] => entry[0].trim().length > 0 && entry[1].trim().length > 0)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

export function buildGeminiGeneratePayload(prompt: string, requestUuid: string): string {
  const request: unknown[] = Array.from({ length: 69 }, () => null);
  request[0] = [prompt, 0, null, null, null, null, 0];
  request[1] = ["en"];
  request[2] = DEFAULT_METADATA;
  request[6] = [1];
  request[7] = 1;
  request[10] = 1;
  request[11] = 0;
  request[17] = [[0]];
  request[18] = 0;
  request[27] = 1;
  request[30] = [4];
  request[41] = [1];
  request[TEMPORARY_CHAT_FLAG_INDEX] = 1;
  request[53] = 0;
  request[59] = requestUuid;
  request[61] = [];
  request[68] = 2;
  return JSON.stringify([null, JSON.stringify(request)]);
}

export function parseGeminiResponseFrames(rawText: string): unknown[] {
  const content = trimJsonPrefix(rawText);
  const frames: unknown[] = [];
  let position = 0;

  while (position < content.length) {
    while (position < content.length && /\s/.test(content[position] ?? "")) position++;

    const match = /^(\d+)\n/.exec(content.slice(position));
    if (!match) break;

    const lengthText = match[1] ?? "0";
    const frameLength = Number.parseInt(lengthText, 10);
    const frameStart = position + lengthText.length;
    const frameText = content.slice(frameStart, frameStart + frameLength).trim();
    position = frameStart + frameLength;

    if (!frameText) continue;
    const parsed = JSON.parse(frameText) as unknown;
    if (Array.isArray(parsed)) frames.push(...parsed);
    else frames.push(parsed);
  }

  if (frames.length > 0) return frames;

  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  const parsed = JSON.parse(content.slice(start, end + 1)) as unknown;
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function extractGeneratedImageRecords(parts: unknown[]): GeminiGeneratedImageRecord[] {
  const records: GeminiGeneratedImageRecord[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const partBody = getNestedValue(part, [2]);
    if (typeof partBody !== "string") continue;

    let parsedPart: unknown;
    try {
      parsedPart = JSON.parse(partBody) as unknown;
    } catch {
      continue;
    }

    const metadata = getNestedValue(parsedPart, [1]);
    const cid = stringValue(getNestedValue(metadata, [0]));
    const rid = stringValue(getNestedValue(metadata, [1]));
    const candidates = getNestedValue(parsedPart, [4]);
    if (!Array.isArray(candidates)) continue;

    for (const candidate of candidates) {
      const rcid = stringValue(getNestedValue(candidate, [0]));
      for (const group of [getNestedValue(candidate, [12, 7, 0]), getNestedValue(candidate, [12, 0, "8", 0])]) {
        if (!Array.isArray(group)) continue;

        for (const item of group) {
          const url = stringValue(getNestedValue(item, [0, 3, 3]));
          if (!url) continue;

          const imageId = stringValue(getNestedValue(item, [1, 0]));
          const dedupeKey = `${url}|${imageId ?? ""}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          records.push({
            url,
            imageId,
            alt: stringValue(getNestedValue(item, [0, 3, 2])),
            cid,
            rid,
            rcid,
          });
        }
      }
    }
  }

  return records;
}

export function toGeminiImageDownloadUrl(url: string, size = "s2048-rj"): string {
  const parsed = new URL(url);
  if (/=s\d+(?:-[^/?#]*)?$/.test(parsed.pathname)) {
    parsed.pathname = parsed.pathname.replace(/=s\d+(?:-[^/?#]*)?$/, `=${size}`);
  } else {
    parsed.pathname = `${parsed.pathname}=${size}`;
  }
  return parsed.toString();
}

export function detectImageType(bytes: Uint8Array): DetectedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { mimeType: "image/webp", extension: "webp" };
  }

  return null;
}

export function getNestedValue(value: unknown, path: Array<number | string>): unknown {
  let current = value;
  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current) || key < 0 || key >= current.length) return undefined;
      current = current[key];
      continue;
    }

    if (!current || typeof current !== "object" || !(key in current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function trimJsonPrefix(rawText: string): string {
  return rawText.startsWith(")]}'") ? rawText.slice(4).trimStart() : rawText.trimStart();
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
