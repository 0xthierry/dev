import type { ImageGenerationProvider, ImageGenerationRequest, ImageGenerationResult } from "../types";
import {
  type ChatGptAgentBrowserTransport,
  createDefaultChatGptAgentBrowserTransport,
  generateWithChatGptAgentBrowser,
} from "./agent-browser";
import { type ChatGptDirectTransport, createDefaultChatGptDirectTransport, generateWithChatGptDirect } from "./direct";

const PROVIDER_ID = "chatgpt-web";
const PROVIDER_LABEL = "ChatGPT Web";

export interface ChatGptWebTransport {
  direct: ChatGptDirectTransport;
  fallback: ChatGptAgentBrowserTransport;
}

export function createChatGptWebProvider(
  transport: ChatGptWebTransport = createDefaultChatGptWebTransport(),
): ImageGenerationProvider {
  return {
    id: PROVIDER_ID,
    aliases: ["chatgpt", "openai-web", "chatgpt-web", "openai"],
    label: PROVIDER_LABEL,
    async generate(request) {
      return generateWithChatGptWeb(request, transport);
    },
  };
}

export function createDefaultChatGptWebTransport(): ChatGptWebTransport {
  return {
    direct: createDefaultChatGptDirectTransport(),
    fallback: createDefaultChatGptAgentBrowserTransport(),
  };
}

export async function generateWithChatGptWeb(
  request: ImageGenerationRequest,
  transport: ChatGptWebTransport,
): Promise<ImageGenerationResult> {
  try {
    return await generateWithChatGptDirect(request, transport.direct);
  } catch (directError) {
    if (request.signal?.aborted || isAbortError(directError)) throw directError;
    try {
      return await generateWithChatGptAgentBrowser(request, transport.fallback);
    } catch (fallbackError) {
      throw new Error(
        `ChatGPT direct Web image generation failed: ${formatError(directError)} Browser/CDP fallback also failed: ${formatError(
          fallbackError,
        )}`,
      );
    }
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
