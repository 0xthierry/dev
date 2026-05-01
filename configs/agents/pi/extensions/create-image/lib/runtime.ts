import { saveGeneratedImages } from "./files";
import { createChatGptWebProvider } from "./providers/chatgpt/web";
import { createGeminiNanoBananaProvider } from "./providers/gemini/nano-banana";
import type { ImageGenerationProvider } from "./providers/types";

export interface CreateImageRuntime {
  providers: ImageGenerationProvider[];
  saveImages: typeof saveGeneratedImages;
  now: () => Date;
}

export function createCreateImageRuntime(): CreateImageRuntime {
  return {
    providers: [createGeminiNanoBananaProvider(), createChatGptWebProvider()],
    saveImages: saveGeneratedImages,
    now: () => new Date(),
  };
}
