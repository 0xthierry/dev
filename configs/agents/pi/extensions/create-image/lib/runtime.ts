import { saveGeneratedImages } from "./files";
import { createGeminiNanoBananaProvider } from "./providers/gemini/nano-banana";
import type { ImageGenerationProvider } from "./providers/types";

export interface CreateImageRuntime {
  providers: ImageGenerationProvider[];
  saveImages: typeof saveGeneratedImages;
  now: () => Date;
}

export function createCreateImageRuntime(): CreateImageRuntime {
  return {
    providers: [createGeminiNanoBananaProvider()],
    saveImages: saveGeneratedImages,
    now: () => new Date(),
  };
}
