import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, truncateHead } from "@earendil-works/pi-coding-agent";
import type { BrowserUseContentBlock } from "./result";

const TRUNCATION_NOTICE = "[Browser Use text truncated at the combined 50 KiB/2000-line limit.]";

/** Bound text as one output stream, while keeping every image in its original order. */
export function formatBrowserUseContent(content: BrowserUseContentBlock[]): BrowserUseContentBlock[] {
  // A newline between text blocks also counts against the shared output budget.
  const combinedText = content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
  if (!truncateHead(combinedText).truncated) return [...content];

  // Reserve space for the notice and its separator within the same budget.
  const truncated = truncateHead(combinedText, {
    maxBytes: DEFAULT_MAX_BYTES - Buffer.byteLength(TRUNCATION_NOTICE, "utf8") - 1,
    maxLines: DEFAULT_MAX_LINES - 1,
  });
  const output: BrowserUseContentBlock[] = [];
  let textOffset = 0;
  for (const block of content) {
    if (block.type === "image") {
      output.push(block);
      continue;
    }
    if (textOffset < truncated.content.length) {
      output.push({ type: "text", text: block.text.slice(0, truncated.content.length - textOffset) });
    }
    textOffset += block.text.length + 1;
  }
  output.push({ type: "text", text: TRUNCATION_NOTICE });
  return output;
}
