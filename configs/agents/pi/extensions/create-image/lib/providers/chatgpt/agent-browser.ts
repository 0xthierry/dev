import { spawn } from "node:child_process";
import type { ImageGenerationProvider, ImageGenerationRequest, ImageGenerationResult } from "../types";
import {
  buildDownloadImageScript,
  buildPollAssetsScript,
  buildSubmitPromptScript,
  type ChatGptAssetPollResult,
  type ChatGptImageDownloadResult,
  type ChatGptSubmitResult,
  detectChatGptImageType,
  parseAgentBrowserJsonOutput,
} from "./agent-browser-protocol";

const PROVIDER_ID = "chatgpt-web";
const PROVIDER_LABEL = "ChatGPT Web";
const CHATGPT_URL = "https://chatgpt.com/";
const DEFAULT_TIMEOUT_MS = 240_000;
const POLL_INTERVAL_MS = 3_000;
const AGENT_BROWSER_COMMAND = "agent-browser";
const CHATGPT_SEND_BUTTON_SELECTOR = 'button[aria-label="Send prompt"]';

export interface AgentBrowserCommandOptions {
  input?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface ChatGptAgentBrowserTransport {
  runAgentBrowser: (args: string[], options?: AgentBrowserCommandOptions) => Promise<string>;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  randomLabel: () => string;
  timeoutMs: number;
  pollIntervalMs: number;
}

export function createChatGptAgentBrowserProvider(
  transport: ChatGptAgentBrowserTransport = createDefaultChatGptAgentBrowserTransport(),
): ImageGenerationProvider {
  return {
    id: PROVIDER_ID,
    aliases: ["chatgpt", "openai-web", "chatgpt-web"],
    label: PROVIDER_LABEL,
    async generate(request) {
      return generateWithChatGptAgentBrowser(request, transport);
    },
  };
}

export function createDefaultChatGptAgentBrowserTransport(): ChatGptAgentBrowserTransport {
  return {
    runAgentBrowser: (args, options) => runAgentBrowserCommand(args, options),
    sleep: (ms, signal) => sleep(ms, signal),
    randomLabel: () => `pi-chatgpt-image-${crypto.randomUUID()}`,
    timeoutMs: readPositiveIntegerEnv("PI_CREATE_IMAGE_CHATGPT_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    pollIntervalMs: readPositiveIntegerEnv("PI_CREATE_IMAGE_CHATGPT_POLL_INTERVAL_MS", POLL_INTERVAL_MS),
  };
}

export async function generateWithChatGptAgentBrowser(
  request: ImageGenerationRequest,
  transport: ChatGptAgentBrowserTransport,
): Promise<ImageGenerationResult> {
  const label = transport.randomLabel();
  let tabOpened = false;

  try {
    await transport.runAgentBrowser(["tab", "new", "--label", label, CHATGPT_URL], {
      timeoutMs: 60_000,
      signal: request.signal,
    });
    tabOpened = true;
    await transport.runAgentBrowser(["wait", "#prompt-textarea"], { timeoutMs: 90_000, signal: request.signal });

    const submit = parseAgentBrowserJsonOutput<ChatGptSubmitResult>(
      await transport.runAgentBrowser(["eval", "--stdin"], {
        input: buildSubmitPromptScript(request.prompt),
        timeoutMs: 30_000,
        signal: request.signal,
      }),
    );
    if (!submit.ok) throw new Error(submit.error ?? "ChatGPT prompt submission failed.");
    await transport.runAgentBrowser(["click", CHATGPT_SEND_BUTTON_SELECTOR], {
      timeoutMs: 30_000,
      signal: request.signal,
    });

    const poll = await waitForGeneratedAsset(transport, request.signal);
    const firstAsset = poll.assets[0];
    if (!poll.conversationId || !firstAsset) {
      throw new Error("ChatGPT did not return a generated image asset pointer.");
    }

    const download = parseAgentBrowserJsonOutput<ChatGptImageDownloadResult>(
      await transport.runAgentBrowser(["eval", "--stdin"], {
        input: buildDownloadImageScript(poll.conversationId, firstAsset.fileId),
        timeoutMs: 90_000,
        signal: request.signal,
      }),
    );
    if (!download.ok || !download.base64) {
      throw new Error(download.error ?? `ChatGPT generated image download failed with HTTP ${download.status}.`);
    }

    const bytes = new Uint8Array(Buffer.from(download.base64, "base64"));
    const detected = detectChatGptImageType(bytes, download.contentType);
    if (!detected) throw new Error("ChatGPT generated image download did not return recognized image bytes.");

    return {
      providerId: PROVIDER_ID,
      providerLabel: PROVIDER_LABEL,
      images: [{ ...detected, bytes, providerImageId: firstAsset.fileId }],
    };
  } finally {
    if (tabOpened) {
      await transport.runAgentBrowser(["tab", "close", label], { timeoutMs: 15_000 }).catch(() => undefined);
    }
  }
}

async function waitForGeneratedAsset(
  transport: ChatGptAgentBrowserTransport,
  signal?: AbortSignal,
): Promise<ChatGptAssetPollResult> {
  const started = Date.now();
  let lastPoll: ChatGptAssetPollResult | null = null;

  while (Date.now() - started < transport.timeoutMs) {
    lastPoll = parseAgentBrowserJsonOutput<ChatGptAssetPollResult>(
      await transport.runAgentBrowser(["eval", "--stdin"], {
        input: buildPollAssetsScript(),
        timeoutMs: 30_000,
        signal,
      }),
    );
    if (lastPoll.ok && lastPoll.assets.length > 0) return lastPoll;
    if (!lastPoll.ok && lastPoll.error && !lastPoll.error.includes("conversation id")) throw new Error(lastPoll.error);
    await transport.sleep(transport.pollIntervalMs, signal);
  }

  const context = lastPoll?.error ? ` Last browser result: ${lastPoll.error}` : "";
  throw new Error(`Timed out waiting for ChatGPT Web image generation.${context}`);
}

function runAgentBrowserCommand(args: string[], options: AgentBrowserCommandOptions = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(AGENT_BROWSER_COMMAND, args, { stdio: ["pipe", "pipe", "pipe"] });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`agent-browser ${args.join(" ")} timed out.`));
    }, options.timeoutMs ?? 30_000);

    const abort = () => {
      child.kill("SIGTERM");
      reject(new Error("ChatGPT Web image generation was aborted."));
    };
    options.signal?.addEventListener("abort", abort, { once: true });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", (error) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      const message = Buffer.concat(stderr).toString("utf8").trim() || Buffer.concat(stdout).toString("utf8").trim();
      reject(new Error(message || `agent-browser ${args.join(" ")} failed with exit code ${code}.`));
    });

    if (options.input) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timeout);
      reject(new Error("ChatGPT Web image generation was aborted."));
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
