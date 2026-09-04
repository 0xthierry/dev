const MAX_TASK_TITLE_LENGTH = 72;
const PI_TITLE_PREFIX = "π · ";

export function formatTaskLabel(prompt: string): string | undefined {
  const plainText = Array.from(prompt.replace(/<image_files>[\s\S]*?<\/image_files>/gi, " "))
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) ? " " : character;
    })
    .join("")
    .replace(/^\s*\/(?:skill:)?[^\s]+\s*/i, "")
    .replace(/^\s*(?:[-*+]\s+|#{1,6}\s+)/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!plainText) return undefined;

  const characters = Array.from(plainText);
  const task =
    characters.length <= MAX_TASK_TITLE_LENGTH
      ? plainText
      : `${characters
          .slice(0, MAX_TASK_TITLE_LENGTH - 1)
          .join("")
          .trimEnd()}…`;

  return task;
}

export function formatTaskTitle(prompt: string): string | undefined {
  const label = formatTaskLabel(prompt);
  return label ? `${PI_TITLE_PREFIX}${label}` : undefined;
}
