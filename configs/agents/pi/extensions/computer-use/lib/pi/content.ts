import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import type { JsonObject } from "../broker/tools";

export interface PiContentResult {
  content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }>;
  fullOutputPath?: string;
}

export async function toPiContent(content: JsonObject[]): Promise<PiContentResult> {
  const textBlocks = content.filter((block) => block.type !== "image").map((block) => String(block.text ?? ""));
  const fullText = textBlocks.join("\n\n");
  const aggregate = truncateHead(fullText, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  if (!aggregate.truncated) {
    return {
      content: content.map((block) =>
        block.type === "image"
          ? { type: "image", data: String(block.data), mimeType: String(block.mimeType) }
          : { type: "text", text: String(block.text ?? "") },
      ),
    };
  }

  const tempDir = await mkdtemp(path.join(tmpdir(), "pi-computer-use-"));
  const fullOutputPath = path.join(tempDir, "output.txt");
  await writeFile(fullOutputPath, fullText, { encoding: "utf8", mode: 0o600 });
  const suffix = `\n\n[Official Computer Use text truncated: showing ${aggregate.outputLines} of ${aggregate.totalLines} lines (${formatSize(aggregate.outputBytes)} of ${formatSize(aggregate.totalBytes)}). Full output saved to: ${fullOutputPath}]`;
  const result: PiContentResult = { content: [], fullOutputPath };
  let textIndex = 0;
  let textOffset = 0;
  let noticeAdded = false;
  for (const block of content) {
    if (block.type === "image") {
      result.content.push({ type: "image", data: String(block.data), mimeType: String(block.mimeType) });
      continue;
    }
    const blockText = String(block.text ?? "");
    const start = textOffset + (textIndex > 0 ? 2 : 0);
    const end = start + blockText.length;
    const retained =
      aggregate.content.length > start ? blockText.slice(0, Math.min(end, aggregate.content.length) - start) : "";
    const cutoffHere: boolean = !noticeAdded && aggregate.content.length < end;
    if (retained || cutoffHere) {
      result.content.push({ type: "text", text: `${retained}${cutoffHere ? suffix : ""}` });
      noticeAdded ||= cutoffHere;
    }
    textOffset = end;
    textIndex += 1;
  }
  return result;
}
