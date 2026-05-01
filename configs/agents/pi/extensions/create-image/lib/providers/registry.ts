import type { ImageGenerationProvider } from "./types";

export function resolveImageProvider(
  providers: ImageGenerationProvider[],
  requestedProvider: string | undefined,
): ImageGenerationProvider | null {
  const normalized = normalizeProviderId(requestedProvider ?? "nano-banana");
  return (
    providers.find(
      (provider) =>
        provider.id === normalized || provider.aliases.some((alias) => normalizeProviderId(alias) === normalized),
    ) ?? null
  );
}

export function listProviderIds(providers: ImageGenerationProvider[]): string[] {
  return providers.map((provider) => provider.id);
}

function normalizeProviderId(value: string): string {
  return value.trim().toLowerCase();
}
