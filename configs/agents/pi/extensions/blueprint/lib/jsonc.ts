export type JsoncParseResult = { ok: true; value: unknown } | { ok: false; error: string };

export function parseJsonc(input: string): JsoncParseResult {
  try {
    return { ok: true, value: JSON.parse(stripJsonc(input)) as unknown };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

function stripJsonc(input: string): string {
  return stripTrailingCommas(stripComments(input));
}

function stripComments(input: string): string {
  let output = "";
  let inString = false;
  let escaping = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];

    if (inString) {
      output += character;
      if (escaping) {
        escaping = false;
      } else if (character === "\\") {
        escaping = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }

    if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      while (index + 1 < input.length && input[index + 1] !== "\n" && input[index + 1] !== "\r") {
        output += " ";
        index += 1;
      }
      continue;
    }

    if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      while (index + 1 < input.length) {
        const commentCharacter = input[index + 1];
        const commentNext = input[index + 2];
        output += commentCharacter === "\n" || commentCharacter === "\r" ? commentCharacter : " ";
        index += 1;
        if (commentCharacter === "*" && commentNext === "/") {
          output += " ";
          index += 1;
          break;
        }
      }
      continue;
    }

    output += character;
  }

  return output;
}

function stripTrailingCommas(input: string): string {
  let output = "";
  let inString = false;
  let escaping = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (inString) {
      output += character;
      if (escaping) {
        escaping = false;
      } else if (character === "\\") {
        escaping = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      output += character;
      continue;
    }

    if (character === "," && nextNonWhitespace(input, index + 1)?.match(/[}\]]/)) {
      output += " ";
      continue;
    }

    output += character;
  }

  return output;
}

function nextNonWhitespace(input: string, start: number): string | undefined {
  for (let index = start; index < input.length; index += 1) {
    const character = input[index];
    if (!/\s/.test(character)) return character;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Unknown error";
}
