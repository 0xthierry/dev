import { saveGeneratedImages } from "./files";
import { createChatGptAgentBrowserProvider } from "./providers/chatgpt/agent-browser";
import { createGeminiNanoBananaProvider } from "./providers/gemini/nano-banana";
import type { ImageGenerationProvider } from "./providers/types";

export interface CreateImageRuntime {
  providers: ImageGenerationProvider[];
  saveImages: typeof saveGeneratedImages;
  now: () => Date;
}

export function createCreateImageRuntime(): CreateImageRuntime {
  return {
    providers: [createGeminiNanoBananaProvider(), createChatGptAgentBrowserProvider()],
    saveImages: saveGeneratedImages,
    now: () => new Date(),
  };
}
