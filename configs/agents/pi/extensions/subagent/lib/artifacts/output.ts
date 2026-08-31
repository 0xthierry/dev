import { truncateTail } from "@earendil-works/pi-coding-agent";
import type { ArtifactPage } from "./artifacts";

export const COMPLETION_PREVIEW_MAX_BYTES = 12 * 1024;
export const AGGREGATE_PREVIEW_MAX_BYTES = 40 * 1024;
export const AGGREGATE_PREVIEW_MAX_LINES = 360;

export interface OutputPreview {
  text: string;
  truncated: boolean;
}

export function prepareCompletionPreview(content: string, artifactReference?: string): OutputPreview {
  const fullOutputNotice = artifactReference ? `\n\n[Full output: ${artifactReference}]` : "";
  if (byteLength(content) + byteLength(fullOutputNotice) <= COMPLETION_PREVIEW_MAX_BYTES) {
    return { text: `${content}${fullOutputNotice}`, truncated: false };
  }

  const notice = artifactReference
    ? `\n\n[Completion preview truncated. Full output: ${artifactReference}]`
    : "\n\n[Completion preview truncated.]";
  const preview = truncateTail(content, {
    maxBytes: COMPLETION_PREVIEW_MAX_BYTES - byteLength(notice),
    maxLines: Number.MAX_SAFE_INTEGER,
  });
  return { text: `${preview.content}${notice}`, truncated: true };
}

export function prepareAggregatePreview(content: string): OutputPreview {
  const initial = truncateTail(content, {
    maxBytes: AGGREGATE_PREVIEW_MAX_BYTES,
    maxLines: AGGREGATE_PREVIEW_MAX_LINES,
  });
  if (!initial.truncated) return { text: initial.content, truncated: false };

  const notice = "\n\n[Aggregate preview truncated; retained tail shown.]";
  const preview = truncateTail(content, {
    maxBytes: AGGREGATE_PREVIEW_MAX_BYTES - byteLength(notice),
    maxLines: AGGREGATE_PREVIEW_MAX_LINES - lineCount(notice) + 1,
  });
  return { text: `${preview.content}${notice}`, truncated: true };
}

/**
 * Formats artifact pages as a prefix-preserving model envelope. Unlike generic
 * aggregate truncation, any reduction also rewrites the byte cursor so omitted
 * content is retrieved on the next request.
 */
export function prepareArtifactPageForModel(page: ArtifactPage): { page: ArtifactPage; text: string } {
  const full = JSON.stringify(page, null, 2);
  if (fitsAggregateBoundary(full)) return { page, text: full };

  const offsets = utf8CodePointOffsets(page.content);
  let low = 0;
  let high = offsets.length - 1;
  let selected = 0;
  let selectedText = "";
  let selectedPage = pagePrefix(page, 0, "");
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const bytes = offsets[middle] ?? 0;
    const content = Buffer.from(page.content, "utf8").subarray(0, bytes).toString("utf8");
    const candidate = pagePrefix(page, bytes, content);
    const encoded = JSON.stringify(candidate, null, 2);
    if (fitsAggregateBoundary(encoded)) {
      selected = middle;
      selectedText = encoded;
      selectedPage = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (selected === 0 && !selectedText) selectedText = JSON.stringify(selectedPage, null, 2);
  return { page: selectedPage, text: selectedText };
}

export function textFromContentParts(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const value = part as Record<string, unknown>;
      return value.type === "text" && typeof value.text === "string" ? [value.text] : [];
    })
    .join("\n");
}

function pagePrefix(page: ArtifactPage, bytes: number, content: string): ArtifactPage {
  const consumedAll = bytes === page.bytes;
  return {
    ...page,
    content,
    bytes,
    lines: pageLineCount(content),
    eof: consumedAll && page.eof,
    ...(!consumedAll || !page.eof ? { nextCursor: page.cursor + bytes } : {}),
  };
}

function utf8CodePointOffsets(content: string): number[] {
  const offsets = [0];
  let bytes = 0;
  for (const codePoint of content) {
    bytes += byteLength(codePoint);
    offsets.push(bytes);
  }
  return offsets;
}

function fitsAggregateBoundary(content: string): boolean {
  return byteLength(content) <= AGGREGATE_PREVIEW_MAX_BYTES && lineCount(content) <= AGGREGATE_PREVIEW_MAX_LINES;
}

function pageLineCount(content: string): number {
  if (!content) return 0;
  const terminators = content.match(/\r\n|\r|\n/g)?.length ?? 0;
  return terminators + (/\r$|\n$/.test(content) ? 0 : 1);
}

function byteLength(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

function lineCount(content: string): number {
  if (!content) return 0;
  return content.split("\n").length;
}
