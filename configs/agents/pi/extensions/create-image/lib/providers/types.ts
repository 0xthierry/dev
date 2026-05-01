export interface ImageGenerationRequest {
  prompt: string;
  profile?: string;
  signal?: AbortSignal;
}

export interface GeneratedImage {
  bytes: Uint8Array;
  mimeType: string;
  extension: string;
  providerImageId?: string;
}

export interface ImageGenerationResult {
  providerId: string;
  providerLabel: string;
  images: GeneratedImage[];
}

export interface ImageGenerationProvider {
  id: string;
  aliases: string[];
  label: string;
  generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}
