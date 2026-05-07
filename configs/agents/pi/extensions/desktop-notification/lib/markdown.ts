import { Markdown, type MarkdownTheme } from "@earendil-works/pi-tui";

const passthrough = (text: string) => text;
const empty = () => "";

export const plainMarkdownTheme: MarkdownTheme = {
  heading: passthrough,
  link: passthrough,
  linkUrl: empty,
  code: passthrough,
  codeBlock: passthrough,
  codeBlockBorder: empty,
  quote: passthrough,
  quoteBorder: empty,
  hr: empty,
  listBullet: empty,
  bold: passthrough,
  italic: passthrough,
  strikethrough: passthrough,
  underline: passthrough,
};

export function renderPlainMarkdown(text: string, width = 80): string {
  const markdown = new Markdown(text, 0, 0, plainMarkdownTheme);
  return markdown.render(width).join("\n");
}
