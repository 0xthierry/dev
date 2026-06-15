import { mkdir, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import type { GeneratedImage } from "./providers/types";

export interface SaveGeneratedImagesOptions {
  cwd: string;
  outputDir?: string;
  fileName?: string;
  prompt: string;
  providerId: string;
}

export interface SavedImage {
  path: string;
  displayPath: string;
  mimeType: string;
  bytes: number;
}

const DEFAULT_OUTPUT_DIR = "generated-images";
const DEFAULT_FILE_STEM = "image";

export async function saveGeneratedImages(
  images: GeneratedImage[],
  options: SaveGeneratedImagesOptions,
): Promise<SavedImage[]> {
  const outputDir = resolveOutputDir(options.cwd, options.outputDir);
  await mkdir(outputDir, { recursive: true });

  const timestamp = new Date();
  const saved: SavedImage[] = [];
  for (let index = 0; index < images.length; index++) {
    const image = images[index];
    const fileName = buildImageFileName({
      baseName: options.fileName,
      prompt: options.prompt,
      providerId: options.providerId,
      now: timestamp,
      index,
      total: images.length,
      extension: image.extension,
    });
    const path = join(outputDir, fileName);
    await writeFile(path, Buffer.from(image.bytes));
    saved.push({
      path,
      displayPath: displayPath(options.cwd, path),
      mimeType: image.mimeType,
      bytes: image.bytes.length,
    });
  }

  return saved;
}

export function resolveOutputDir(cwd: string, outputDir = DEFAULT_OUTPUT_DIR): string {
  return isAbsolute(outputDir) ? resolve(outputDir) : resolve(cwd, outputDir);
}

export function buildImageFileName(options: {
  baseName?: string;
  prompt: string;
  providerId: string;
  now: Date;
  index: number;
  total: number;
  extension: string;
}): string {
  const requestedStem = options.baseName ? stripExtension(options.baseName) : undefined;
  const stem = sanitizeFileStem(requestedStem ?? options.prompt) || DEFAULT_FILE_STEM;
  const timestamp = formatTimestamp(options.now);
  const suffix = options.total > 1 ? `-${options.index + 1}` : "";
  return `${timestamp}-${sanitizeFileStem(options.providerId)}-${stem}${suffix}.${options.extension}`;
}

export function sanitizeFileStem(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .toLowerCase();
}

function stripExtension(value: string): string {
  const extension = extname(value);
  return extension ? value.slice(0, -extension.length) : value;
}

function displayPath(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  return rel && !rel.startsWith("..") && !isAbsolute(rel) ? rel : path;
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}
