export const CHATGPT_BASE_URL = "https://chatgpt.com";
export const CHATGPT_AUTH_SESSION_URL = `${CHATGPT_BASE_URL}/api/auth/session`;
export const CHATGPT_CONVERSATION_URL = `${CHATGPT_BASE_URL}/backend-api/f/conversation`;
export const CHATGPT_PREPARE_URL = `${CHATGPT_BASE_URL}/backend-api/sentinel/chat-requirements/prepare`;
export const CHATGPT_FINALIZE_URL = `${CHATGPT_BASE_URL}/backend-api/sentinel/chat-requirements/finalize`;
export const CHATGPT_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";
export const DEFAULT_CHATGPT_IMAGE_MODEL = "gpt-5-5-thinking";

const DEFAULT_SCRIPT_URL = `${CHATGPT_BASE_URL}/cdn/assets/4813494d-inff8751hn64hqn1.js`;
const HASH_PREFIX = "wQ8Lk5FbGpA2NcR9dShT6gYjU7VxZ4D";

const DOCUMENT_KEYS = ["body", "head", "documentElement", "scripts"];
const WINDOW_KEYS = ["window", "document", "navigator", "location", "crypto"];

export interface ChatGptBuildInfo {
  clientVersion: string;
  buildNumber: string;
  scriptUrls: string[];
}

export interface ChatGptProofConfigOptions {
  userAgent: string;
  clientVersion: string;
  scriptUrls: string[];
  random: () => number;
  randomUUID: () => string;
  now: () => Date;
  hardwareConcurrency?: number;
  screenWidth?: number;
  screenHeight?: number;
  language?: string;
  languages?: string[];
  locationSearch?: string;
}

export interface ChatGptProofRequirement {
  required?: boolean;
  seed?: string;
  difficulty?: string;
}

export interface ChatGptPreparedRequirements {
  persona?: string;
  prepare_token?: string;
  turnstile?: { required?: boolean; dx?: string };
  proofofwork?: ChatGptProofRequirement;
  so?: { required?: boolean; collector_dx?: string; snapshot_dx?: string };
}

export interface ChatGptFinalizedRequirements {
  persona?: string;
  token?: string;
  expire_after?: number;
  expire_at?: number;
}

export interface ChatGptSession {
  accessToken?: string;
  sessionToken?: string;
}

export interface ChatGptConversationStreamSummary {
  conversationId?: string;
  text: string;
  sawImageSignal: boolean;
}

export interface ChatGptGeneratedAsset {
  assetPointer: string;
  fileId: string;
  sizeBytes?: number;
  width?: number;
  height?: number;
  status?: string;
}

export function buildChatGptCookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .filter((entry): entry is [string, string] => entry[0].trim().length > 0 && entry[1].trim().length > 0)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

export function extractChatGptBuildInfo(html: string): ChatGptBuildInfo {
  const clientVersion = matchHtmlAttribute(html, "data-build");
  const buildNumber = matchHtmlAttribute(html, "data-seq");
  if (!clientVersion || !buildNumber) {
    throw new Error("Unable to read ChatGPT web build metadata from chatgpt.com.");
  }

  return {
    clientVersion,
    buildNumber,
    scriptUrls: extractChatGptScriptUrls(html),
  };
}

export function buildChatGptRequirementsToken(config: unknown[]): string {
  return `gAAAAAC${encodeJsonBase64(config)}`;
}

export function buildChatGptProofConfig(options: ChatGptProofConfigOptions): unknown[] {
  const now = options.now();
  const scriptUrls = options.scriptUrls.length > 0 ? options.scriptUrls : [DEFAULT_SCRIPT_URL];
  const hardwareConcurrency = options.hardwareConcurrency ?? 32;
  const scriptUrl = pick(scriptUrls, options.random);
  const navigatorKey = pick(buildNavigatorKeys(options.userAgent, hardwareConcurrency), options.random);
  const documentKey = pick(DOCUMENT_KEYS, options.random);
  const windowKey = pick(WINDOW_KEYS, options.random);
  const screenWidth = options.screenWidth ?? 2560;
  const screenHeight = options.screenHeight ?? 1440;
  const language = options.language ?? "en-US";
  const languages = options.languages ?? ["en-US", "en"];
  const locationSearchKeys = [...new URLSearchParams(options.locationSearch ?? "").keys()].join(",");

  return [
    screenWidth + screenHeight,
    String(now),
    null,
    options.random(),
    options.userAgent,
    scriptUrl,
    options.clientVersion,
    language,
    languages.join(","),
    options.random(),
    navigatorKey,
    documentKey,
    windowKey,
    now.getTime(),
    options.randomUUID(),
    locationSearchKeys,
    hardwareConcurrency,
    now.getTime(),
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ];
}

export function generateChatGptProofToken(
  requirement: ChatGptProofRequirement | undefined,
  options: ChatGptProofConfigOptions,
  maxAttempts = 500_000,
): string | undefined {
  if (!requirement?.required) return undefined;
  const seed = requirement.seed;
  const difficulty = requirement.difficulty;
  if (typeof seed !== "string" || typeof difficulty !== "string") return undefined;

  const started = options.now().getTime();
  try {
    const config = buildChatGptProofConfig(options);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      config[3] = attempt;
      config[9] = options.now().getTime() - started;
      const answer = encodeJsonBase64(config);
      if (chatGptProofHash(`${seed}${answer}`).slice(0, difficulty.length) <= difficulty) {
        return `gAAAAAB${answer}~S`;
      }
    }
  } catch (error) {
    return buildProofFailureToken(error);
  }

  return buildProofFailureToken();
}

export function chatGptProofHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909) >>> 0;
  hash ^= hash >>> 16;
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildChatGptCommonHeaders(options: {
  cookieHeader: string;
  accessToken: string;
  clientVersion: string;
  buildNumber: string;
  deviceId: string;
  sessionId: string;
  userAgent?: string;
}): Record<string, string> {
  return {
    accept: "*/*",
    "accept-language": "en-US,en;q=0.8",
    "content-type": "application/json",
    origin: CHATGPT_BASE_URL,
    referer: `${CHATGPT_BASE_URL}/`,
    "sec-ch-ua": '"Brave";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Linux"',
    "user-agent": options.userAgent ?? CHATGPT_USER_AGENT,
    cookie: options.cookieHeader,
    authorization: `Bearer ${options.accessToken}`,
    "oai-language": "en-US",
    "oai-client-version": options.clientVersion,
    "oai-client-build-number": options.buildNumber,
    "oai-device-id": options.deviceId,
    "oai-session-id": options.sessionId,
  };
}

export function buildChatGptTargetHeaders(path: string, route = path): Record<string, string> {
  return {
    "x-openai-target-path": path,
    "x-openai-target-route": route,
  };
}

export function buildChatGptFinalizeBody(options: {
  prepareToken?: string;
  proofToken?: string;
  turnstileToken?: string;
}): Record<string, string> {
  const body: Record<string, string> = { prepare_token: options.prepareToken ?? "" };
  if (options.proofToken) body.proofofwork = options.proofToken;
  if (options.turnstileToken) body.turnstile = options.turnstileToken;
  return body;
}

export function buildChatGptConversationPayload(options: {
  prompt: string;
  parentMessageId?: string;
  messageId: string;
  model: string;
  now: Date;
  timezoneOffsetMin?: number;
  timezone?: string;
}): Record<string, unknown> {
  return {
    action: "next",
    messages: [
      {
        id: options.messageId,
        author: { role: "user" },
        create_time: options.now.getTime() / 1000,
        content: { content_type: "text", parts: [options.prompt] },
        metadata: {
          developer_mode_connector_ids: [],
          selected_sources: [],
          selected_github_repos: [],
          selected_all_github_repos: false,
          serialization_metadata: { custom_symbol_offsets: [] },
        },
      },
    ],
    parent_message_id: options.parentMessageId ?? "client-created-root",
    model: options.model,
    client_prepare_state: "none",
    timezone_offset_min: options.timezoneOffsetMin ?? options.now.getTimezoneOffset(),
    timezone: options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    conversation_mode: { kind: "primary_assistant" },
    enable_message_followups: true,
    system_hints: [],
    supports_buffering: true,
    supported_encodings: ["v1"],
    client_contextual_info: {
      is_dark_mode: false,
      time_since_loaded: 7,
      page_height: 1277,
      page_width: 2538,
      pixel_ratio: 1.5,
      screen_height: 1440,
      screen_width: 2560,
      app_name: "chatgpt.com",
    },
    paragen_cot_summary_display_override: "allow",
    force_parallel_switch: "auto",
    thinking_effort: "standard",
  };
}

export function parseChatGptConversationStream(rawText: string): ChatGptConversationStreamSummary {
  let conversationId: string | undefined;
  let text = "";
  let sawImageSignal = false;

  for (const rawLine of rawText.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;

    let event: unknown;
    try {
      event = JSON.parse(line.slice(6)) as unknown;
    } catch {
      continue;
    }

    const value = getRecordValue(event, "v");
    if (isRecord(value)) {
      const id = getRecordValue(value, "conversation_id");
      if (typeof id === "string") conversationId = id;
      if (
        isRecord(getNestedRecord(value, ["message", "metadata"])) &&
        getNestedRecord(value, ["message", "metadata", "image_gen_task_id"])
      ) {
        sawImageSignal = true;
      }
      continue;
    }

    if (!Array.isArray(value)) continue;
    for (const op of value) {
      if (!isRecord(op)) continue;
      const path = getRecordValue(op, "p");
      const opValue = getRecordValue(op, "v");
      if (path === "/message/content/parts/0" && typeof opValue === "string") text += opValue;
      if (typeof path === "string" && path.includes("image")) sawImageSignal = true;
    }
  }

  if (!conversationId) {
    const match = rawText.match(/"conversation_id"\s*:\s*"([^"]+)"/);
    if (match?.[1]) conversationId = match[1];
  }

  return { conversationId, text, sawImageSignal };
}

export function extractChatGptGeneratedAssets(conversation: unknown): ChatGptGeneratedAsset[] {
  if (!isRecord(conversation)) return [];
  const mapping = getRecordValue(conversation, "mapping");
  if (!isRecord(mapping)) return [];

  const assets: ChatGptGeneratedAsset[] = [];
  const seen = new Set<string>();
  for (const node of Object.values(mapping)) {
    const message = getNestedRecord(node, ["message"]);
    const parts = getNestedRecord(message, ["content", "parts"]);
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      if (!isRecord(part) || getRecordValue(part, "content_type") !== "image_asset_pointer") continue;
      const assetPointer = getRecordValue(part, "asset_pointer");
      if (typeof assetPointer !== "string" || seen.has(assetPointer)) continue;
      seen.add(assetPointer);
      assets.push({
        assetPointer,
        fileId: assetPointer.replace(/^(?:sediment|file-service):\/\//, ""),
        sizeBytes: optionalNumber(getRecordValue(part, "size_bytes")),
        width: optionalNumber(getRecordValue(part, "width")),
        height: optionalNumber(getRecordValue(part, "height")),
        status: optionalString(getRecordValue(message, "status")),
      });
    }
  }

  return assets;
}

function buildNavigatorKeys(userAgent: string, hardwareConcurrency: number): string[] {
  return [
    `userAgent−${userAgent}`,
    "vendor−Google Inc.",
    "webdriver−false",
    `hardwareConcurrency−${hardwareConcurrency}`,
    "cookieEnabled−true",
  ];
}

function extractChatGptScriptUrls(html: string): string[] {
  const urls = new Set<string>();
  for (const match of html.matchAll(/(?:https:\/\/chatgpt\.com)?(\/cdn\/assets\/[^"'<>\s)]+?\.js)/g)) {
    const path = match[1];
    if (path) urls.add(`${CHATGPT_BASE_URL}${path}`);
  }
  return [...urls];
}

function matchHtmlAttribute(html: string, attribute: string): string | undefined {
  const match = html.match(new RegExp(`${attribute}="([^"]+)"`));
  return match?.[1];
}

function buildProofFailureToken(error?: unknown): string {
  return `${HASH_PREFIX}${encodeJsonBase64(error instanceof Error ? error.message : String(error ?? "e"))}`;
}

function encodeJsonBase64(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

function pick<T>(items: T[], random: () => number): T {
  const first = items[0];
  if (first === undefined) throw new Error("Cannot pick from an empty list.");
  return items[Math.min(Math.floor(random() * items.length), items.length - 1)] ?? first;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getRecordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function getNestedRecord(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
