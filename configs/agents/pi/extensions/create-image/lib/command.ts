import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { CREATE_IMAGE_USAGE, parseCreateImageArgs } from "./arguments";
import type { SavedImage } from "./files";
import { listProviderIds, resolveImageProvider } from "./providers/registry";
import type { ImageGenerationResult } from "./providers/types";
import type { CreateImageRuntime } from "./runtime";

export async function handleCreateImageCommand(
  pi: ExtensionAPI,
  runtime: CreateImageRuntime,
  rawArgs: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  const parsed = parseCreateImageArgs(rawArgs);
  if (!parsed.ok) {
    publishCreateImageMessage(pi, `Could not parse /create-image arguments.\n\n${parsed.error}\n\n${parsed.usage}`, {
      ok: false,
      error: parsed.error,
    });
    notify(ctx, parsed.error, "error");
    return;
  }

  if (parsed.args.help) {
    publishCreateImageMessage(pi, CREATE_IMAGE_USAGE, { ok: true, help: true });
    return;
  }

  const prompt = await getPrompt(parsed.args.prompt, ctx);
  if (!prompt) {
    publishCreateImageMessage(pi, `Missing image prompt.\n\n${CREATE_IMAGE_USAGE}`, {
      ok: false,
      error: "Missing prompt",
    });
    notify(ctx, "Missing image prompt.", "error");
    return;
  }

  const provider = resolveImageProvider(runtime.providers, parsed.args.provider);
  if (!provider) {
    const available = listProviderIds(runtime.providers).join(", ");
    const message = `Unknown image provider: ${parsed.args.provider}. Available providers: ${available}.`;
    publishCreateImageMessage(pi, message, { ok: false, error: message });
    notify(ctx, message, "error");
    return;
  }

  notify(ctx, `Generating image with ${provider.label}...`, "info");

  try {
    const result = await provider.generate({ prompt, profile: parsed.args.profile, signal: ctx.signal });
    const saved = await runtime.saveImages(result.images, {
      cwd: ctx.cwd,
      outputDir: parsed.args.outputDir,
      fileName: parsed.args.fileName,
      prompt,
      providerId: provider.id,
      now: runtime.now(),
    });
    publishCreateImageMessage(pi, formatCreateImageResult(result, saved), {
      ok: true,
      providerId: result.providerId,
      providerLabel: result.providerLabel,
      prompt,
      files: saved,
    });
    notify(ctx, `Created ${saved.length} image(s).`, "info");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    publishCreateImageMessage(pi, `Image generation failed.\n\n${message}`, { ok: false, error: message, prompt });
    notify(ctx, `Image generation failed: ${message}`, "error");
  }
}

export function formatCreateImageResult(result: ImageGenerationResult, saved: SavedImage[]): string {
  const lines = [`Created ${saved.length} image(s) with ${result.providerLabel}.`, ""];
  for (const image of saved) {
    lines.push(`- ${image.displayPath} (${image.mimeType}, ${image.bytes} bytes)`);
  }
  return lines.join("\n");
}

function publishCreateImageMessage(pi: ExtensionAPI, content: string, details: Record<string, unknown>): void {
  pi.sendMessage({ customType: "create-image-result", content, display: true, details });
}

async function getPrompt(prompt: string, ctx: ExtensionCommandContext): Promise<string> {
  if (prompt) return prompt;
  if (!ctx.hasUI) return "";
  const value = await ctx.ui.editor("Create image prompt", "generate an image of ");
  return value?.trim() ?? "";
}

function notify(ctx: ExtensionCommandContext, message: string, type: "info" | "warning" | "error"): void {
  if (ctx.hasUI) ctx.ui.notify(message, type);
}
